
var routerConstructor = function() {
    return require('express').Router();
};

var expandMap = function(map) {
    var out = {};
    var arrStack = [], arr;

    Object.keys(map).forEach(function(key) {
        var value = map[key], o = out, i;

        key = key.split(/\./g);
        for(i = 0; i < key.length - 1; i++) {
            o[key[i]] = o[key[i]] || {};
            if(!isNaN(parseInt(key[i + 1], 10)) && arrStack.indexOf(o) === -1) {
                arrStack.push({
                    parent: o,
                    key: key[i],
                    array: o[key[i]]
                });
            }
            o = o[key[i]];
        };
        o[key[i]] = value;
    });

    while(arr = arrStack.shift()) {
        arr.parent[arr.key] = Object.keys(arr.array).filter(function(a) {
            return !isNaN(parseInt(a, 10));
        }).map(function(a) {
            return parseInt(a, 10);
        }).sort().map(function(i) {
            return arr.array[i];
        });

        Object.keys(arr.array).filter(function(a) {
            return isNaN(parseInt(a, 10));
        }).forEach(function(a) {
            arr.parent[arr.key][a] = arr.array[a];
        });
    }

    return out;
};

var pluralize = function(name) {
    if(name.substring(name.length - 1) === 'y') return name.substring(0, name.length - 1) + 'ies';
    if(name.substring(name.length - 2) === 'is') return name.substring(0, name.length - 2) + 'es';
    if(name.substring(name.length - 1) === 'x') return name + 'es';
    if(name.substring(name.length - 1) === 's') return name + 'es';
    return name + 's';
}

module.exports = function(model, prototype) {
    var baseName = model.modelName.match(/[A-Z][^A-Z]+/g).map(function(token) {
        return token.toLowerCase();
    }).join('-');
    var paramName = model.modelName[0].toLowerCase() + model.modelName.substring(1);

    var catalogEntry = {
        model: model.modelName,
        methods: []
    };
    catalog.push(catalogEntry);

    var router = routerConstructor();
    catalogEntry.router = router;

    var init = function() {};
    var constructor = Function('init', 'return function ' + model.modelName + '() { init.apply(this, arguments); }').call(null, function() {
        init.apply(this, arguments);
    });
    constructor.prototype = Object.create(ApiObject.prototype);
    Object.defineProperty(constructor.prototype, 'constructor', {
        enumerable: false,
        value: constructor
    });

    var staticHandler = function(method) {
        return function(req, res) {
            var user, query;
            if(req.method === 'GET') {
                query = expandMap(req.query);
            } else {
                query = expandMap(req.body);
            }

            if(query.authenticatedUser) {
                user = query.authenticatedUser;
                delete query.authenticatedUser;
            } else {
                user = req.user;
            }

            try {
                method.call(constructor, user, query, function (err, object) {
                    var jso;

                    if (err) {
                        if(err.type) {
                            jso = { error: {
                                type: err.type,
                                message: err.message,
                                code: err.code
                            } };
                        } else {
                            jso = { error: { type: 'server-error' } };
                        }
                    } else {
                        if(Array.isArray(object)) {
                            jso = {
                                length: typeof object.count === 'undefined' ? object.length : object.count,
                                aggregates: object.aggregates
                            };
                            jso[pluralize(paramName)] = object;
                        } else {
                            jso = {};
                            jso[paramName] = object;
                        }
                    }

                    var json = JSON.stringify(jso);

                    res.set('Content-Type', 'application/json');
                    res.set('Content-Length', json.length);
                    res.send(json);
                });
            } catch(e) {
                console.error(e);
                var json = JSON.stringify({ error: { type: 'server-error' }});

                res.set('Content-Type', 'application/json');
                res.set('Content-Length', json.length);
                res.send(json);
            }
        };
    };

    var instanceHandler = function(method) {
        return function(req, res) {
            var user, query;
            if(req.method === 'GET') {
                query = expandMap(req.query);
            } else {
                query = expandMap(req.body);
            }

            if(query.authenticatedUser) {
                user = query.authenticatedUser;
                delete query.authenticatedUser;
            } else {
                user = req.user;
            }

            try {
                method.call({ id: req.params[paramName] }, user, query, function (err, object) {
                    var jso;

                    if (err) {
                        if(err.type) {
                            jso = { error: {
                                type: err.type,
                                message: err.message,
                                code: err.code
                            } };
                        } else {
                            jso = { error: { type: 'server-error' } };
                        }
                    } else {
                        if(Array.isArray(object)) {
                            jso = {
                                length: typeof object.count === 'undefined' ? object.length : object.count,
                                aggregates: object.aggregates
                            };
                            jso[pluralize(paramName)] = object;
                        } else {
                            jso = {};
                            jso[paramName] = object;
                        }
                    }

                    var json = JSON.stringify(jso);

                    res.set('Content-Type', 'application/json');
                    res.set('Content-Length', json.length);
                    res.send(json);
                });
            } catch(e) {
                console.error(e);
                var json = JSON.stringify({ error: { type: 'server-error' }});

                res.set('Content-Type', 'application/json');
                res.set('Content-Length', json.length);
                res.send(json);
            }
        };
    };

    Object.keys(prototype).forEach(function(key) {
        if(key[0] === '$') {
            var methodName = key.substring(1).split(/[A-Z][^A-Z]*/g).map(function(token) {
                return token.toLowerCase();
            }).join('-');

            switch(methodName) {
                case '$create':
                    router.post('/' + baseName, staticHandler(prototype.$create));
                    catalogEntry.methods.push({
                        accessor: 'static',
                        name: 'create',
                        method: 'POST',
                        url: '/' + baseName
                    });
                    init = function() {
                        var descriptor = Object.getOwnPropertyDescriptor(this, 'save');
                        Object.defineProperty(this, 'save', {
                            configurable: true,
                            enumerable: false,
                            writable: true,
                            value: function(user, next) {
                                var query = {};
                                query[paramName] = this;

                                prototype.$create.call(constructor, user, query, function(err, user) {
                                    if(!err) Object.defineProperty(this, 'save', descriptor);
                                    next(err, user);
                                });
                            }
                        });
                    };
                    break;
                case '$find':
                    router.get('/' + baseName, staticHandler(prototype.$find));
                    catalogEntry.methods.push({
                        accessor: 'static',
                        name: 'find',
                        method: 'GET',
                        url: '/' + baseName
                    });
                    constructor.find = function(user, query, next) {
                        prototype.$find.call(constructor, user, query, next);
                    };
                    break;
                case '$findOne':
                    router.get('/' + baseName + '/:' + paramName, staticHandler(prototype.$findOne));
                    catalogEntry.methods.push({
                        accessor: 'static',
                        name: 'findOne',
                        method: 'GET',
                        url: '/' + baseName + '/{' + paramName + '}'
                    });
                    constructor.findOne = function(user, id, next) {
                        var query = {};
                        (query[paramName] = {}).id = id;
                        prototype.$findOne.call(constructor, user, query, next);
                    };
                    break;
                default:
                    router.post('/' + baseName + '/' + methodName, staticHandler(prototype[key]));
                    catalogEntry.methods.push({
                        accessor: 'static',
                        name: key.substring(1),
                        method: 'POST',
                        url: '/' + baseName + '/' + methodName
                    });
                    constructor[key.substring(1)] = function(user, query, next) {
                        prototype[key].call(constructor, user, query, next);
                    };
                    break;
            }
        } else {
            var methodName = key.split(/[A-Z][^A-Z]*/g).map(function(token) {
                return token.toLowerCase();
            }).join('-');

            switch(methodName) {
                case 'createChild':
                    router.post('/' + baseName + '/:' + paramName + '/children', instanceHandler(prototype.createChild));
                    catalogEntry.methods.push({
                        accessor: 'instance',
                        name: 'createChild',
                        method: 'POST',
                        url: '/' + baseName + '/:' + paramName + '/children'
                    });
                    Object.defineProperty(constructor.prototype, key, {
                        configurable: true,
                        enumerable: false,
                        writable: true,
                        value: function(user, query, next) {
                            prototype[key].call({ id: this.id }, user, query, next);
                        }
                    });
                    break;
                case 'children':
                    router.get('/' + baseName + '/:' + paramName + '/children', instanceHandler(prototype.children));
                    catalogEntry.methods.push({
                        accessor: 'instance',
                        name: 'children',
                        method: 'GET',
                        url: '/' + baseName + '/:' + paramName + '/children'
                    });
                    Object.defineProperty(constructor.prototype, key, {
                        configurable: true,
                        enumerable: false,
                        writable: true,
                        value: function(user, query, next) {
                            prototype[key].call({ id: this.id }, user, query, next);
                        }
                    });
                    break;
                case 'descendants':
                    router.get('/' + baseName + '/:' + paramName + '/descendants', instanceHandler(prototype.descendants));
                    catalogEntry.methods.push({
                        accessor: 'instance',
                        name: 'descendants',
                        method: 'GET',
                        url: '/' + baseName + '/:' + paramName + '/descendants'
                    });
                    Object.defineProperty(constructor.prototype, key, {
                        configurable: true,
                        enumerable: false,
                        writable: true,
                        value: function(user, query, next) {
                            prototype[key].call({ id: this.id }, user, query, next);
                        }
                    });
                    break;
                case 'save':
                    router.post('/' + baseName + '/:' + paramName, instanceHandler(prototype.save));
                    catalogEntry.methods.push({
                        accessor: 'instance',
                        name: 'save',
                        method: 'POST',
                        url: '/' + baseName + '/:' + paramName
                    });
                    Object.defineProperty(constructor.prototype, key, {
                        configurable: true,
                        enumerable: false,
                        writable: true,
                        value: function(user, next) {
                            var query = {};
                            query[paramName] = this;
                            prototype[key].call({ id: this.id }, user, query, next);
                        }
                    });
                    break;
                case 'delete':
                    router.delete('/' + baseName + '/:' + paramName, instanceHandler(prototype.delete));
                    catalogEntry.methods.push({
                        accessor: 'instance',
                        name: 'delete',
                        method: 'DELETE',
                        url: '/' + baseName + '/:' + paramName
                    });
                    Object.defineProperty(constructor.prototype, key, {
                        configurable: true,
                        enumerable: false,
                        writable: true,
                        value: function(user, next) {
                            prototype[key].call({ id: this.id }, user, {}, next);
                        }
                    });
                    break;
                default:
                    router.post('/' + baseName + '/:' + paramName + '/' + methodName, instanceHandler(prototype[key]));
                    catalogEntry.methods.push({
                        accessor: 'instance',
                        name: key,
                        method: 'POST',
                        url: '/' + baseName + '/:' + paramName + '/' + methodName
                    });
                    Object.defineProperty(constructor.prototype, key, {
                        configurable: true,
                        enumerable: false,
                        writable: true,
                        value: function(user, query, next) {
                            prototype[key].call({ id: this.id }, user, query, next);
                        }
                    });
                    break;
            }
        }
    });

    return constructor;
};

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

    var rebasedCatalog = catalog.map(function(entry) {
        return {
            model: entry.model,
            methods: entry.methods.map(function(method) {
                return {
                    accessor: method.accessor,
                    name: method.name,
                    method: method.method,
                    url: baseUrl + method.url
                };
            })
        };
    });

    var router = routerConstructor();
    router.get(baseUrl + '/catalog', function(req, res) {
        var json = JSON.stringify(rebasedCatalog);
        res.set('Content-Type', 'application/json');
        res.set('Content-Length', json.length);
        res.send(json);
    });
    catalog.forEach(function(entry) {
        router.use(entry.router);
    });

    return router;
};