const { transformSync } = require('@babel/core');
const transformUndeclaredVariables = require('babel-plugin-transform-undeclared-variables');
const transformLastStatement = require('babel-plugin-transform-last-statement');
const tagTemplateLiterals = require('babel-plugin-transform-tag-template-literals');
const createTemplateTag = require('process-template-literals');
const omniformat = require('omniformat');
const { readFileSync } = require('fs');
const { createRequire } = require('module');

// WeakMap don't accept string keys :(
// so resolving to use a Map instead
const cache = new Map();

/**
 * Wraps a call
 * @param {} callback
 */
function withCache(callback) {
  return function(templateOrPath, { cacheKey = false, ...options } = {}) {
    if (cacheKey) {
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
      } else {
        const result = callback(templateOrPath, options);
        cache.set(cacheKey, result);
        return result;
      }
    }

    return callback(templateOrPath, options);
  };
}

/**
 * Compiles the given `templateString` into a template
 *
 * @param {String} templateString - The string to compile
 * @param {Object} options
 * @param {String} [tagName='html'] - The variable name for tagging the template literals
 * @param {Function} [formatter='omniformat'] - The function used for formatting the expressions
 * @param {Function} [tag] - The tag used tagging the template literals
 * @return {Function} The compiled template, ready to accept a `data` object to render into String
 */
const compile = withCache(function(
  templateString,
  {
    tagName = 'html',
    formatter = omniformat,
    tag = createProcessorTag(formatter)
  } = {}
) {
  const { code } = transformSync(templateString, {
    plugins: [
      [transformUndeclaredVariables],
      [transformLastStatement, { topLevel: true }],
      [tagTemplateLiterals, { tagName }]
    ]
  });
  const templateFunction = new Function('data', code);
  return async function(data = {}) {
    // The template might return an array, or anything, actually
    // so we need to format it again
    return formatter(templateFunction({ [tagName]: tag, ...data }));
  };
});

function createProcessorTag(formatter) {
  return createTemplateTag(({ strings, expressions }) => {
    const processedExpressions = expressions.map(formatter);
    // Handle that some of the formatted values might have been promises
    if (processedExpressions.some(v => v instanceof Promise)) {
      return Promise.all(processedExpressions).then(
        fullfilledProcessedExpressions => ({
          strings,
          expressions: fullfilledProcessedExpressions
        })
      );
    }
    // If none are Promises, we can keep things synchronous
    return { strings, expressions: processedExpressions };
  });
}

module.exports.compile = compile;

/**
 * Compiles the file at the given path
 * @param {String} filePath
 * @param {Object} options - @see compile.params:options
 */

const cachedCompileFile = withCache(function compileFile(filePath, options) {
  const contents = readFileSync(filePath);
  const template = compile(contents, {
    options
  });
  return async function(data) {
    return template({ require: createRequire(filePath), ...data });
  };
});

const compileFile = function(filePath, options) {
  return cachedCompileFile(filePath, { cacheKey: filePath, ...options });
};

module.exports.compileFile = compileFile;

/** */
async function render(templateString, data, options) {
  const template = compile(templateString, options);
  return template(data);
}

module.exports.render = render;

async function renderFile(filePath, data, options) {
  const template = compileFile(filePath, options);
  return template(data);
}

module.exports.renderFile = renderFile;
