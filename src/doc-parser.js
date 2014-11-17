
var fs = require('fs');
var esprima = require('esprima');
var estraverse = require('estraverse');
var doctrine = require('doctrine');
var util = require('./util');

module.exports = function(filePath, offset, model, prototype) {

    var baseName = model.modelName.match(/[A-Z][^A-Z]+/g).map(function (token) {
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
    } catch (e) {
        console.error(e.stack);
        return {};
    }

    var docs = {};

    var parse = function (node) {
        return node && node.leadingComments && node.leadingComments.filter(function (comment) {
                return comment.type === 'Block';
            }).map(function (comment) {
                return comment.value.toString()
            }).filter(function (comment) {
                return /^\*/.test(comment);
            }).map(function (comment) {
                return comment.split(/\n|\r\n/g).map(function (line) {
                    return line.replace(/^\s*\*\s*/, '').trim();
                }).join('\r\n').replace(/^\r\n/, '').replace(/\r\n$/, '');
            }).join('\r\n') || null
    };

    estraverse.attachComments(ast, ast.comments, ast.tokens);
    estraverse.traverse(ast, {
        enter: function (node, parent) {
            node.parent = parent;

            if (node.type === 'CallExpression' && node.range[0] < offset && node.range[1] > offset) {
                var p = node;
                while ((!p.leadingComments || p.leadingComments.filter(function (comment) {
                    return comment.type === 'Block' && /^\*/.test(comment.value.toString());
                }).length) && p.parent.type !== 'Program') p = p.parent;

                var doc = parse(p);
                doc = doc && doctrine.parse(doc);

                var title = doc && doc.tags.filter(function (tag) {
                        return tag.title === 'title';
                    }).map(function (tag) {
                        return tag.description
                    })[0] || util.pluralize(model.modelName);

                docs.model = model.modelName;
                docs.description = doc && doc.description.split(/\n|\r\n/)[0];
                docs.title = title;
                docs.text = doc && doc.description;
                docs.methods = [];

                node.arguments[1].properties.forEach(function (node) {
                    var name = node.key.name, accessor, method, url;


                    if (name[0] === '$') {
                        name = name.substring(1);
                        var methodName = name.match(/(^|[A-Z])[^A-Z]*/g).map(function (token) {
                            return token.toLowerCase();
                        }).join('-');

                        accessor = 'static';
                        switch (name) {
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
                        var methodName = name.match(/(^|[A-Z])[^A-Z]*/g).map(function (token) {
                            return token.toLowerCase();
                        }).join('-');
                        accessor = 'instance';
                        switch (name) {
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

                    doc.tags.forEach(function (tag) {
                        if (tag.title === 'url' && !inUrl) inUrl = true;
                        if (tag.title === 'endurl' && inUrl) inUrl = false;
                        if (tag.title === 'form' && !inUrl) inForm = true;
                        if (tag.title === 'endform' && inUrl) inForm = false;
                        if (tag.title === 'query' && !inUrl) inQuery = true;
                        if (tag.title === 'endquery' && inUrl) inQuery = false;

                        if (tag.title === 'param') {

                            var type = tag.type;

                            switch (type.type) {
                                case 'NameExpression':
                                    type = {
                                        name: type.name
                                    };
                                    break;
                                case 'TypeApplication':
                                    type = {
                                        name: type.expression.name + '<' + type.applications.map(function (type) {
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

                            if (inUrl) urlParams.push(param);
                            if (inForm) formParams.push(param);
                            if (inQuery) queryParams.push(param);
                        }
                    });

                    docs.methods.push({
                        accessor: accessor,
                        name: name,
                        method: method,
                        url: url,
                        description: doc && doc.description.split(/\n|\r\n/)[0],
                        title: doc && doc.tags.filter(function (tag) {
                            return tag.title === 'title';
                        }).map(function (tag) {
                            return tag.description
                        })[0],
                        text: doc && doc.description,
                        permissions: doc && doc.tags.filter(function (tag) {
                            return tag.title === 'permission';
                        }).map(function (tag) {
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