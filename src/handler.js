
var util = require('./util');

module.exports = function(pre, post, impl) {
    return function (returnType, method) {

        returnType = returnType.match(/[A-Z][^A-Z]+/g).map(function (token) {
            return token.toLowerCase();
        }).join('-');
        returnType = returnType[0].toLowerCase() + returnType.substring(1);

        return function (req, hres) {
            var user, query;
            if (req.method === 'GET') {
                query = util.expandMap(req.query);
            } else {
                query = util.expandMap(req.body);
            }

            user = req.user;

            try {
                var filters = (pre['message'] || []).slice();
                var next = function (err, req) {
                    if (err) {
                        console.error(e.stack);
                        var json = JSON.stringify({error: {type: 'server-error'}});

                        hres.set('Content-Type', 'application/json');
                        hres.set('Content-Length', json.length);
                        hres.send(json);
                        return;
                    }

                    var filter = filters.shift();
                    if (!filter) {
                        impl.call(this, method, req, function (err, object) {
                            if (!req.rawResponse) {
                                var jso;

                                if (err) {
                                    if (err.type) {
                                        jso = {
                                            error: {
                                                type: err.type,
                                                message: err.message,
                                                code: err.code
                                            }
                                        };
                                    } else {
                                        console.error(err.stack);
                                        jso = {error: {type: 'server-error'}};
                                    }
                                } else {
                                    if (Array.isArray(object)) {
                                        jso = {
                                            length: typeof object.count === 'undefined' ? object.length : object.count,
                                            aggregates: object.aggregates
                                        };
                                        jso[util.pluralize(returnType)] = object;
                                    } else {
                                        jso = {};
                                        jso[returnType] = object;
                                    }
                                }
                            }

                            var filters = (post['message'] || []).slice();
                            var next = function (err, res) {
                                if (err) {
                                    console.error(e.stack);
                                    var json = JSON.stringify({error: {type: 'server-error'}});

                                    hres.set('Content-Type', 'application/json');
                                    hres.set('Content-Length', json.length);
                                    hres.send(json);
                                    return;
                                }

                                var filter = filters.shift();
                                if (!filter) {
                                    if (!req.rawResponse) {
                                        var json = JSON.stringify(res);

                                        hres.set('Content-Type', 'application/json');
                                        hres.set('Content-Length', json.length);
                                        hres.send(json);
                                    } else {
                                        hres.end();
                                    }
                                    return;
                                }

                                filter(req, res, hres, next);
                            };
                            if (!req.rawResponse) next(null, jso);
                            else next(null, object);
                        });
                        return;
                    }

                    filter(req, next);
                }.bind(req);
                next(null, {headers: req.headers, user: user, query: query});
            } catch (e) {
                console.error(e.stack);
                var json = JSON.stringify({error: {type: 'server-error'}});

                hres.set('Content-Type', 'application/json');
                hres.set('Content-Length', json.length);
                hres.send(json);
            }
        };
    };
};