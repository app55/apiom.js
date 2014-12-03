

module.exports = {
    routerConstructor: function () {
        var router = require('express').Router();
        router.use(function(req, res, next) {
            if(req.log) {
                req.log = req.log.child({ apiom: true });
            }
            next();
        });
        return router;
    },

    expandMap: function (map) {
        var out = {};
        var arrStack = [], arr;

        Object.keys(map).forEach(function (key) {
            var value = map[key], o = out, i;

            key = key.split(/\./g);
            for (i = 0; i < key.length - 1; i++) {
                o[key[i]] = o[key[i]] || {};
                if (!isNaN(parseInt(key[i + 1], 10)) && arrStack.indexOf(o) === -1) {
                    arrStack.push({
                        parent: o,
                        key: key[i],
                        array: o[key[i]]
                    });
                }
                o = o[key[i]];
            }
            ;
            o[key[i]] = value;
        });

        while (arr = arrStack.shift()) {
            arr.parent[arr.key] = Object.keys(arr.array).filter(function (a) {
                return !isNaN(parseInt(a, 10));
            }).map(function (a) {
                return parseInt(a, 10);
            }).sort().map(function (i) {
                return arr.array[i];
            });

            Object.keys(arr.array).filter(function (a) {
                return isNaN(parseInt(a, 10));
            }).forEach(function (a) {
                arr.parent[arr.key][a] = arr.array[a];
            });
        }

        return out;
    },

    pluralize: function (name) {
        if (name.substring(name.length - 1) === 'y' && name.substring(name.length - 2) !== 'ay') return name.substring(0, name.length - 1) + 'ies';
        if (name.substring(name.length - 2) === 'is') return name.substring(0, name.length - 2) + 'es';
        if (name.substring(name.length - 1) === 'x') return name + 'es';
        if (name.substring(name.length - 1) === 's') return name + 'es';
        return name + 's';
    }
};