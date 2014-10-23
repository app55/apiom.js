
var fs = require('fs');
var esprima = require('esprima');
var estraverse = require('estraverse');
var doctrine = require('doctrine');

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
};

var parseJsDoc = function(filePath, offset, model, prototype) {

    var baseName = model.modelName.match(/[A-Z][^A-Z]+/g).map(function(token) {
        return token.toLowerCase();
    }).join('-');
    var paramName = model.modelName[0].toLowerCase() + model.modelName.substring(1);

    var document = fs.readFileSync(filePath);
    try {
        var ast = esprima.parse(document, {
            tokens: true,
            comment: true,
            range: true
        });
    } catch(e) {
        console.error(e.stack);
        return {};
    }

    var docs = {};

    var parse = function(node) {
        return node && node.leadingComments && node.leadingComments.filter(function(comment) {
            return comment.type === 'Block';
        }).map(function(comment) {
            return comment.value.toString()
        }).filter(function(comment) {
            return /^\*/.test(comment);
        }).map(function(comment) {
            return comment.split(/\n|\r\n/g).map(function(line) {
                return line.replace(/^\s*\*\s*/, '').trim();
            }).join('\r\n').replace(/^\r\n/, '').replace(/\r\n$/, '');
        }).join('\r\n') || null
    };

    estraverse.attachComments(ast, ast.comments, ast.tokens);
    estraverse.traverse(ast, {
        enter: function(node, parent) {
            node.parent = parent;

            if(node.type === 'CallExpression' && node.range[0] < offset && node.range[1] > offset) {
                var p = node;
                while((!p.leadingComments || p.leadingComments.filter(function(comment) {
                    return comment.type === 'Block' && /^\*/.test(comment.value.toString());
                }).length) && p.parent.type !== 'Program') p = p.parent;

                var doc = parse(p);
                doc = doc && doctrine.parse(doc);

                var title = doc && doc.tags.filter(function(tag) {
                    return tag.title === 'title';
                }).map(function(tag) {
                    return tag.description
                })[0] || pluralize(model.modelName);

                docs.model = model.modelName;
                docs.description = doc && doc.description.split(/\n|\r\n/)[0];
                docs.title = title;
                docs.text = doc && doc.description;
                docs.methods = [];

                node.arguments[1].properties.forEach(function(node) {
                    var name = node.key.name, accessor, method, url;



                    if(name[0] === '$') {
                        name = name.substring(1);
                        var methodName = name.match(/(^|[A-Z])[^A-Z]*/g).map(function(token) {
                            return token.toLowerCase();
                        }).join('-');

                        accessor = 'static';
                        switch(name) {
                            case 'create':
                                method = 'POST';
                                url = '/' + baseName;
                                break;
                            case 'find':
                                method = 'GET';
                                url = '/' + baseName;
                                break;
                            case 'findOne':
                                method = 'GET';
                                url = '/' + baseName + '/:' + paramName;
                                break;
                            default:
                                method = 'POST';
                                url = '/' + baseName + '/' + methodName;
                                break;
                        }
                    } else {
                        var methodName = name.match(/(^|[A-Z])[^A-Z]*/g).map(function(token) {
                            return token.toLowerCase();
                        }).join('-');
                        accessor = 'instance';
                        switch(name) {
                            case 'createChild':
                                method = 'POST';
                                url = '/' + baseName + '/:' + paramName + '/children';
                                break;
                            case 'children':
                                method = 'GET';
                                url = '/' + baseName + '/:' + paramName + '/children';
                                break;
                            case 'descendants':
                                method = 'GET';
                                url = '/' + baseName + '/:' + paramName + '/descendants';
                                break;
                            case 'save':
                                method = 'POST';
                                url = '/' + baseName + '/:' + paramName;
                                break;
                            case 'delete':
                                method = 'DELETE';
                                url = '/' + baseName + '/:' + paramName;
                                break;
                            default:
                                method = 'POST';
                                url = '/' + baseName + '/:' + paramName + '/' + methodName;
                                break;
                        }
                    }

                    var urlParams = [], inUrl;
                    var formParams = [], inForm;
                    var queryParams = [], inQuery;

                    var doc = parse(node);
                    doc = doc && doctrine.parse(doc);

                    doc.tags.forEach(function(tag) {
                        if(tag.title === 'url' && !inUrl) inUrl = true;
                        if(tag.title === 'endurl' && inUrl) inUrl = false;
                        if(tag.title === 'form' && !inUrl) inForm = true;
                        if(tag.title === 'endform' && inUrl) inForm = false;
                        if(tag.title === 'query' && !inUrl) inQuery = true;
                        if(tag.title === 'endquery' && inUrl) inQuery = false;

                        if(tag.title === 'param') {

                            var type = tag.type;

                            switch(type.type) {
                                case 'NameExpression':
                                    type = {
                                        name: type.name
                                    };
                                    break;
                                case 'TypeApplication':
                                    type = {
                                        name: type.expression.name + '<' + type.applications.map(function(type) {
                                            return type.name;
                                        }).join(', ') + '>'
                                    };
                                    break;
                            }

                            var param = {
                                name: tag.name,
                                description: tag.description,
                                type: type
                            };

                            if(inUrl) urlParams.push(param);
                            if(inForm) formParams.push(param);
                            if(inQuery) queryParams.push(param);
                        }
                    });

                    docs.methods.push({
                        accessor: accessor,
                        name: name,
                        method: method,
                        url: url,
                        description: doc && doc.description.split(/\n|\r\n/)[0],
                        title: doc && doc.tags.filter(function(tag) {
                            return tag.title === 'title';
                        }).map(function(tag) {
                            return tag.description
                        })[0],
                        text: doc && doc.description,
                        permissions: doc && doc.tags.filter(function(tag) {
                            return tag.title === 'permission';
                        }).map(function(tag) {
                            var name = tag.description.trim().match(/^\s*(\w+)\s+(\(optional\)\s+)?(.*)$/);
                            var description = name[3].trim();
                            var optional = name[2] && true || false;
                            name = name[1].trim();

                            return {
                                name: name,
                                description: description,
                                optional: optional
                            };
                        }),
                        params: {
                            url: urlParams,
                            query: queryParams,
                            form: formParams
                        }
                    });
                });
            }


        }
    });

    return docs;
};

module.exports = function(model, prototype) {

    var orig = Error.prepareStackTrace;
    Error.prepareStackTrace = function(_, stack) {
        return stack;
    };
    var err = new Error;
    Error.captureStackTrace(err, arguments.callee);
    var stack = err.stack;
    Error.prepareStackTrace = orig;


    var baseName = model.modelName.match(/[A-Z][^A-Z]+/g).map(function(token) {
        return token.toLowerCase();
    }).join('-');
    var paramName = model.modelName[0].toLowerCase() + model.modelName.substring(1);

    var catalogEntry = {
        model: model.modelName,
        methods: [],
        fields: { id: { type: 'ID', ref: model.modelName } },
        docs: parseJsDoc(stack[1].receiver.filename, stack[0].pos, model, prototype)
    };
    catalog.push(catalogEntry);

    model.schema.eachPath(function(path, schemaType) {
        if(path[0] === '_') return;
        if(schemaType.options.hidden) return;

        if(schemaType.options.type === Boolean)
            catalogEntry.fields[path] = { type: 'Boolean' };
        else if(schemaType.options.type === Number)
            catalogEntry.fields[path] = { type: 'Number' };
        else if(schemaType.options.type === String)
            catalogEntry.fields[path] = { type: 'String' };
        else if(schemaType.instance === 'ObjectID')
            catalogEntry.fields[path] = { type: 'ID', ref: schemaType.options.ref };
        else
            catalogEntry.fields[path] = { type: schemaType.instance, ref: schemaType.options.ref };
    });

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
                method.call(constructor, { user: user, query: query }, function (err, object) {
                    var jso;

                    if (err) {
                        if(err.type) {
                            jso = { error: {
                                type: err.type,
                                message: err.message,
                                code: err.code
                            } };
                        } else {
                            console.error(err.stack);
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
                console.error(e.stack);
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
                method.call({ id: req.params[paramName] }, { user: user, query: query }, function (err, object) {
                    var jso;

                    if (err) {
                        if(err.type) {
                            jso = { error: {
                                type: err.type,
                                message: err.message,
                                code: err.code
                            } };
                        } else {
                            console.error(err.stack);
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
                console.error(e.stack);
                var json = JSON.stringify({ error: { type: 'server-error' }});

                res.set('Content-Type', 'application/json');
                res.set('Content-Length', json.length);
                res.send(json);
            }
        };
    };

    Object.keys(prototype).forEach(function(key) {
        if(key[0] === '$') {
            var methodName = key.substring(1).match(/(^|[A-Z])[^A-Z]*/g).map(function(token) {
                return token.toLowerCase();
            }).join('-');

            switch(key) {
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
                    router.get('/' + baseName + '/:' + paramName, function(req, res) {
                        (req.query[paramName] = {}).id = req.params[paramName];
                        staticHandler(prototype.$findOne)(req, res);
                    });
                    catalogEntry.methods.push({
                        accessor: 'static',
                        name: 'findOne',
                        method: 'GET',
                        url: '/' + baseName + '/:' + paramName
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
            var methodName = key.match(/(^|[A-Z])[^A-Z]*/g).map(function(token) {
                return token.toLowerCase();
            }).join('-');

            switch(key) {
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

    var rebasedCatalog = JSON.stringify(catalog.map(function(entry) {
        return {
            model: entry.model,
            fields: entry.fields,
            methods: entry.methods.map(function(method) {
                return {
                    accessor: method.accessor,
                    name: method.name,
                    method: method.method,
                    url: method.url
                };
            })
        };
    }));

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
                    method: method.method,
                    url: method.url,
                    description: method.description,
                    title: method.title,
                    text: method.text,
                    permissions: method.permissions,
                    params: method.params
                };
            })
        };
    }));

    var router = routerConstructor();
    router.get(baseUrl + '/catalog', function(req, res) {
        var json = rebasedCatalog;
        res.set('Content-Type', 'application/json');
        res.set('Content-Length', json.length);
        res.send(json);
    });
    router.get(baseUrl + '/catalog.doc', function(req, res) {
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