
var docParser = require('./src/doc-parser');
var util = require('./src/util');
var handler = require('./src/handler');

module.exports = function(model, prototype) {

    var orig = Error.prepareStackTrace;
    Error.prepareStackTrace = function (_, stack) {
        return stack;
    };
    var err = new Error;
    Error.captureStackTrace(err, arguments.callee);
    var stack = err.stack;
    Error.prepareStackTrace = orig;


    var baseName = model.modelName.match(/[A-Z][^A-Z]+/g).map(function (token) {
        return token.toLowerCase();
    }).join('-');
    var paramName = model.modelName[0].toLowerCase() + model.modelName.substring(1);

    var catalogEntry = {
        model: model.modelName,
        methods: [],
        fields: {id: {type: 'ID', ref: model.modelName}},
        scripts: {},
        docs: docParser(stack[1].receiver.filename, stack[0].pos, model, prototype)
    };
    catalog.push(catalogEntry);

    var serializeType = function(schemaType, options) {
        var type;

        if (options.type === Boolean)
            type = { type: 'Boolean', displayName: options.displayName };
        else if (options.type === Number)
            type = { type: 'Number', displayName: options.displayName };
        else if (options.type === String)
            type = { type: 'String', displayName: options.displayName };
        else if (options.type === Date)
            type = { type: 'Date', displayName: options.displayName };
        else if (Array.isArray(options.type)) {
            type = serializeType(schemaType, options.type[0]);
            type.isArray = true;
        } else if ((schemaType.caster && schemaType.caster.instance || schemaType.instance) === 'ObjectID') {
            type = {type: 'ID', displayName: options.displayName, ref: options.ref};
        } else {
            type = { type: schemaType.instance, displayName: options.displayName, ref: options.ref }
        }

        if(options.filterUsing) {
            type.filterType = serializeType(schemaType, model.schema.path(options.filterUsing).options).type;
        }

        return type;
    };

    model.schema.eachPath(function (path, schemaType) {
        if (path[0] === '_') return;
        if (schemaType.options.hidden) return;

        catalogEntry.fields[path] = serializeType(schemaType, schemaType.options);

    });

    var router = util.routerConstructor();
    catalogEntry.router = router;

    var init = function () {
    };
    var constructor = Function('init', 'return function ' + model.modelName + '() { init.apply(this, arguments); }').call(null, function () {
        init.apply(this, arguments);
    });
    constructor.prototype = Object.create(ApiObject.prototype);
    Object.defineProperty(constructor.prototype, 'constructor', {
        enumerable: false,
        value: constructor
    });


    var staticHandler = handler(pre, post, function(method, req, next) {
        return method.call(constructor, req, next);
    });

    var instanceHandler = handler(pre, post, function(method, req, next) {
        return method.call({ id: this.params[paramName] }, req, next);
    });

    constructor.script = function(name, descriptor) {
        descriptor.get = descriptor.get && descriptor.get.toString();
        descriptor.set = descriptor.set && descriptor.set.toString();
        descriptor.value = typeof descriptor.value === 'function' && descriptor.value.toString();
        catalogEntry.scripts[name] = descriptor;
        return this;
    };

    process.nextTick(function() {

        (pre['init'] || []).forEach(function(callback) {
            callback(model, prototype);
        });

        var keys = Object.keys(prototype);
        if(keys.indexOf('$findOne') !== -1) {
            keys.splice(keys.indexOf('$findOne'), 1);
            keys.push('$findOne');
        }

        keys.forEach(function (key) {
            var method;
            if(prototype[key] instanceof module.exports.method) {
                method = prototype[key];
                prototype[key] = prototype[key].callback;
            } else {
                method = new module.exports.method(model.modelName, prototype[key]);
            }

            if (key[0] === '$') {
                var methodName = key.substring(1).match(/(^|[A-Z])[^A-Z]*/g).map(function (token) {
                    return token.toLowerCase();
                }).join('-');

                switch (key) {
                    case '$create':
                        router[(method._httpMethod || 'POST').toLowerCase()]('/' + baseName, staticHandler(method.returnType, prototype.$create));
                        catalogEntry.methods.push({
                            accessor: 'static',
                            name: 'create',
                            returnType: method.returnType,
                            method: method._httpMethod || 'POST',
                            url: '/' + baseName
                        });
                        init = function () {
                            var descriptor = Object.getOwnPropertyDescriptor(this, 'save');
                            Object.defineProperty(this, 'save', {
                                configurable: true,
                                enumerable: false,
                                writable: true,
                                value: function (user, next) {
                                    var query = {};
                                    query[paramName] = this;

                                    prototype.$create.call(constructor, user, query, function (err, user) {
                                        if (!err) Object.defineProperty(this, 'save', descriptor);
                                        next(err, user);
                                    });
                                }
                            });
                        };
                        break;
                    case '$find':
                        router[(method._httpMethod || 'GET').toLowerCase()]('/' + baseName, staticHandler(method.returnType, prototype.$find));
                        catalogEntry.methods.push({
                            accessor: 'static',
                            name: 'find',
                            returnType: method.returnType,
                            method: method._httpMethod || 'GET',
                            url: '/' + baseName
                        });
                        constructor.find = function (user, query, next) {
                            prototype.$find.call(constructor, user, query, next);
                        };
                        break;
                    case '$findOne':
                        router[(method._httpMethod || 'GET').toLowerCase()]('/' + baseName + '/:' + paramName, function (req, res) {
                            (req.query[paramName] = {}).id = req.params[paramName];
                            staticHandler(method.returnType, prototype.$findOne)(req, res);
                        });
                        catalogEntry.methods.push({
                            accessor: 'static',
                            name: 'findOne',
                            returnType: method.returnType,
                            method: method._httpMethod || 'GET',
                            url: '/' + baseName + '/:' + paramName
                        });
                        constructor.findOne = function (user, id, next) {
                            var query = {};
                            (query[paramName] = {}).id = id;
                            prototype.$findOne.call(constructor, user, query, next);
                        };
                        break;
                    default:
                        router[(method._httpMethod || 'POST').toLowerCase()]('/' + baseName + '/' + methodName, staticHandler(method.returnType, prototype[key]));
                        catalogEntry.methods.push({
                            accessor: 'static',
                            name: key.substring(1),
                            returnType: method.returnType,
                            method: method._httpMethod || 'POST',
                            url: '/' + baseName + '/' + methodName
                        });
                        constructor[key.substring(1)] = function (user, query, next) {
                            prototype[key].call(constructor, user, query, next);
                        };
                        break;
                }
            } else {
                var methodName = key.match(/(^|[A-Z])[^A-Z]*/g).map(function (token) {
                    return token.toLowerCase();
                }).join('-');

                switch (key) {
                    case 'createChild':
                        router[(method._httpMethod || 'POST').toLowerCase()]('/' + baseName + '/:' + paramName + '/children', instanceHandler(method.returnType, prototype.createChild));
                        catalogEntry.methods.push({
                            accessor: 'instance',
                            name: 'createChild',
                            returnType: method.returnType,
                            method: method._httpMethod || 'POST',
                            url: '/' + baseName + '/:' + paramName + '/children'
                        });
                        Object.defineProperty(constructor.prototype, key, {
                            configurable: true,
                            enumerable: false,
                            writable: true,
                            value: function (user, query, next) {
                                prototype[key].call({id: this.id}, user, query, next);
                            }
                        });
                        break;
                    case 'children':
                        router[(method._httpMethod || 'GET').toLowerCase()]('/' + baseName + '/:' + paramName + '/children', instanceHandler(method.returnType, prototype.children));
                        catalogEntry.methods.push({
                            accessor: 'instance',
                            name: 'children',
                            returnType: method.returnType,
                            method: method._httpMethod || 'GET',
                            url: '/' + baseName + '/:' + paramName + '/children'
                        });
                        Object.defineProperty(constructor.prototype, key, {
                            configurable: true,
                            enumerable: false,
                            writable: true,
                            value: function (user, query, next) {
                                prototype[key].call({id: this.id}, user, query, next);
                            }
                        });
                        break;
                    case 'descendants':
                        router[(method._httpMethod || 'GET').toLowerCase()]('/' + baseName + '/:' + paramName + '/descendants', instanceHandler(method.returnType, prototype.descendants));
                        catalogEntry.methods.push({
                            accessor: 'instance',
                            name: 'descendants',
                            returnType: method.returnType,
                            method: method._httpMethod || 'GET',
                            url: '/' + baseName + '/:' + paramName + '/descendants'
                        });
                        Object.defineProperty(constructor.prototype, key, {
                            configurable: true,
                            enumerable: false,
                            writable: true,
                            value: function (user, query, next) {
                                prototype[key].call({id: this.id}, user, query, next);
                            }
                        });
                        break;
                    case 'save':
                        router[(method._httpMethod || 'POST').toLowerCase()]('/' + baseName + '/:' + paramName, instanceHandler(method.returnType, prototype.save));
                        catalogEntry.methods.push({
                            accessor: 'instance',
                            name: 'save',
                            returnType: method.returnType,
                            method: method._httpMethod || 'POST',
                            url: '/' + baseName + '/:' + paramName
                        });
                        Object.defineProperty(constructor.prototype, key, {
                            configurable: true,
                            enumerable: false,
                            writable: true,
                            value: function (user, next) {
                                var query = {};
                                query[paramName] = this;
                                prototype[key].call({id: this.id}, user, query, next);
                            }
                        });
                        break;
                    case 'delete':
                        router[(method._httpMethod || 'DELETE').toLowerCase()]('/' + baseName + '/:' + paramName, instanceHandler(method.returnType, prototype.delete));
                        catalogEntry.methods.push({
                            accessor: 'instance',
                            name: 'delete',
                            returnType: method.returnType,
                            method: method._httpMethod || 'DELETE',
                            url: '/' + baseName + '/:' + paramName
                        });
                        Object.defineProperty(constructor.prototype, key, {
                            configurable: true,
                            enumerable: false,
                            writable: true,
                            value: function (user, next) {
                                prototype[key].call({id: this.id}, user, {}, next);
                            }
                        });
                        break;
                    default:
                        router[(method._httpMethod || 'POST').toLowerCase()]('/' + baseName + '/:' + paramName + '/' + methodName, instanceHandler(method.returnType, prototype[key]));
                        catalogEntry.methods.push({
                            accessor: 'instance',
                            name: key,
                            returnType: method.returnType,
                            method: method._httpMethod || 'POST',
                            url: '/' + baseName + '/:' + paramName + '/' + methodName
                        });
                        Object.defineProperty(constructor.prototype, key, {
                            configurable: true,
                            enumerable: false,
                            writable: true,
                            value: function (user, query, next) {
                                prototype[key].call({id: this.id}, user, query, next);
                            }
                        });
                        break;
                }
            }
        });

        (post['init'] || []).forEach(function(callback) {
            callback(constructor);
        });
    });


    return constructor;
};

module.exports.method = function(returnType, callback) {
    if(!(this instanceof module.exports.method)) return new module.exports.method(returnType, callback);
    this.returnType = returnType;
    this.callback = callback;
};

module.exports.method.prototype.httpMethod = function(httpMethod) {
    this._httpMethod = httpMethod;
    return this;
};

var pre = {}, post = {};

module.exports.pre = function(message, filter) {
    pre[message] = pre[message] || [];
    pre[message].push(filter);
};

module.exports.post = function(message, filter) {
    post[message] = post[message] || [];
    post[message].unshift(filter);
}

var ApiObject = module.exports.ApiObject = function ApiObject() {};

Object.defineProperty(module.exports, 'router', {
    configurable: false,
    enumerable: true,
    get: function() {
        return routerConstructor;
    },
    set: function(value) {
        routerContructor = value;
    }
});

var catalog = [];
module.exports.catalog = function(baseUrl) {
    baseUrl = baseUrl || '/';

    var router = util.routerConstructor();
    router.get(baseUrl + '/catalog', function(req, res) {
        var rebasedCatalog = JSON.stringify(catalog.map(function(entry) {
            return {
                model: entry.model,
                fields: entry.fields,
                methods: entry.methods.map(function(method) {
                    return {
                        accessor: method.accessor,
                        name: method.name,
                        returnType: method.returnType,
                        method: method.method,
                        url: method.url
                    };
                }),
                scripts: entry.scripts
            };
        }));

        var json = rebasedCatalog;
        res.set('Content-Type', 'application/json');
        res.set('Content-Length', json.length);
        res.send(json);
    });
    router.get(baseUrl + '/catalog.doc', function(req, res) {
        var docCatalog = JSON.stringify(catalog.map(function(entry) {
            return {
                model: entry.docs.model,
                fields: entry.docs.fields,
                description: entry.docs.description,
                title: entry.docs.title,
                text: entry.docs.text,
                methods: entry.docs.methods.map(function(method) {
                    return {
                        accessor: method.accessor,
                        name: method.name,
                        returnType: method.returnType,
                        method: method.method,
                        url: method.url,
                        description: method.description,
                        title: method.title,
                        text: method.text,
                        permissions: method.permissions,
                        params: method.params
                    };
                }),
                scripts: entry.scripts
            };
        }));

        var json = docCatalog;
        res.set('Content-Type', 'application/json');
        res.set('Content-Length', json.length);
        res.send(json);
    });

    catalog.forEach(function(entry) {
        router.use(baseUrl, entry.router);
    });

    return router;
};



