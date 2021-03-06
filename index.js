var debug = require('debug')('mock-xhr-router');

var version = 0;

function routeRegExp(r) {
  return new RegExp("^" + r.replace(/:[a-z0-0]+/gi, "([^/?]*)") + "(\\?(.*))?$");
}

function params(pattern, url) {
  var re = /:([a-z0-9]+)/gi;
  var m = void 0;
  var vars = [];

  function matches() {
    m = re.exec(pattern);
    if (m) {
      vars.push(m[1]);
      return matches();
    }
  }

  matches();
  var routeMatch = routeRegExp(pattern).exec(url);
  var hash = {};

  for (var n = 0; n < vars.length; ++n) {
    hash[vars[n]] = decodeURIComponent(routeMatch[n + 1]);
  }

  return hash;
}

function query(url){
  var hasQueryString = url.indexOf('?');
  var hash = {};
  if (hasQueryString) {
    var queryString = url.substring(url.indexOf('?')+1);

    queryString.split(/&/).forEach(function(param) {
      var paramNameValue = param.split(/=/);
      var name = paramNameValue[0];
      var value = decodeURIComponent(paramNameValue[1]);
      hash[name] = value;
    });
  }
  return hash;
}

function shallowClone(o) {
  var result = {};

  Object.keys(o).forEach(function (key) {
    result[key] = o[key];
  });

  return result;
}

function Router() {
  this.routes = [];

  var self = this;

  module.exports.xhr.onrequest = function (xhrRequest) {
    var requestVersion = version;

    return new Promise(function (resolve) {
      var route = findFirst(self.routes, function (route) {
        return xhrRequest.url.match(routeRegExp(route.url)) && xhrRequest.method.toLowerCase() === route.method;
      });

      function successResponse(response) {
        if (requestVersion == version && running) {
          response = response? shallowClone(response): {};
          buildResponse(response);
          debug(xhrRequest.method.toUpperCase() + ' ' + xhrRequest.url + ' => ' + response.statusCode, xhrRequest, shallowClone(response));
          response.body = serialiseResponseBody(response);
          resolve(response);
        }
      }

      function errorResponse(error) {
        successResponse({
          statusCode: 500,
          headers: {'content-type': 'application/json; charset=UTF-8'},
          body: { message: error.message, stack: error.stack }
        });
      }

      if (route) {
        var request = {
          headers: xhrRequest.headers,
          body: xhrRequest.body,
          method: xhrRequest.method,
          url: xhrRequest.url,
          params: params(route.url, xhrRequest.url),
          query: query(xhrRequest.url)
        };
        buildRequest(request);

        try {
          Promise.resolve(route.handler(request)).then(successResponse, errorResponse);
        } catch (error) {
          errorResponse(error);
        }
      } else {
        successResponse({
          statusCode: 404,
          headers: {'Content-Type': 'text/plain'},
          body: 'route not found: ' + xhrRequest.method.toUpperCase() + ' ' + xhrRequest.url
        });
      }
    });
  };
}

function findFirst(array, filter) {
  for(var n = 0; n < array.length; n++) {
    var item = array[n];
    if (filter(item)) {
      return item;
    }
  }
}

["get", "delete", "head", "post", "put", "patch"].forEach(function(method) {
  Router.prototype[method] = function(url, handler) {
    this.routes.push({url: url, handler: handler, method: method});
  };
});

function isJsonMimeType(mimeType) {
  return /^application\/json($|\b)/.test(mimeType);
}

function hyphenCaseHeaders(headers) {
  var lowHeaders = {};

  var headerNames = Object.keys(headers);
  for (var n = 0; n < headerNames.length; n++) {
    var name = headerNames[n];
    var headerName = name.replace(/(^|-)([a-z])/g, function (x) { return x.toUpperCase(); });
    lowHeaders[headerName] = headers[name];
  }

  return lowHeaders;
}

function lowerCaseHeaders(headers) {
  var lowHeaders = {};

  var headerNames = Object.keys(headers);
  for (var n = 0; n < headerNames.length; n++) {
    var name = headerNames[n];
    lowHeaders[name.toLowerCase()] = headers[name];
  }

  return lowHeaders;
}

function buildRequest(request) {
  request.headers = lowerCaseHeaders(request.headers);
  if (isJsonMimeType(request.headers['content-type'])) {
    request.body = JSON.parse(request.body);
  }
}

function serialiseResponseBody(response) {
  if (isJsonMimeType(response.headers['Content-Type'])) {
    return JSON.stringify(response.body, null, 2);
  } else {
    var body = response.body;

    return body == undefined? '': body;
  }
}

function buildResponse(response) {
  if (!response.statusCode) {
    response.statusCode = 200;
  }
  if (!response.headers) {
    response.headers = {};
  } else {
    response.headers = hyphenCaseHeaders(response.headers);
  }

  if (!response.body || typeof response.body === 'string') {
    response.headers['Content-Type'] = 'text/plain; charset=UTF-8';
  }

  if (response.body && response.body instanceof Object) {
    response.headers['Content-Type'] = 'application/json; charset=UTF-8';
  }
}

var running = false;

function restore() {
  module.exports.xhr.stop();
}

function install() {
  version++;
  module.exports.xhr.start();
}

function stop() {
  if (running) {
    restore();
  }
  running = false;
}

function router() {
  return new Router();
}

module.exports = function() {
  if (!running) {
    install();
    running = true;
  } else {
    restore();
    install();
  }
  return router();
};

module.exports.stop = stop;

module.exports.xhr = module.exports.fauxjax = require('./fauxjaxAdapter');
module.exports.fakeXhr = require('./fakeXhrAdapter');
