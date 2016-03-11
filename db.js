var MongoClient = require('mongodb').MongoClient;
var assert = require('assert');

var DataBase = function() {
    if(!process.env.MONGOLAB_URI && !process.env.MONGO_URL) {
        throw new Error('Missing mongodb url environment variable. Exiting...');
        process.exit(1);
    }

    this.url = process.env.MONGOLAB_URI || process.env.MONGO_URL;
};

DataBase.prototype = {
    connect: function(cb) {
        MongoClient.connect(this.url, function(err, db) {
            assert.equal(null, err);
            console.log("Connected correctly to server");

            this.db = db;
            this.ready = true;

            cb();
        }.bind(this));
    },
    insert: function(user, cb) {
        if(!this.ready) {
            return cb();
        }
        var collection = this.db.collection('users');
        collection.insert([
            user
        ], function(err, result) {
            assert.equal(err, null);
            assert.equal(1, result.result.n);
            assert.equal(1, result.ops.length);
            cb(result.result);
        });
    },
    update: function(user, cb) {
        if(!this.ready) {
            return cb();
        }
        var collection = this.db.collection('users');
        collection.update({channel: user.id}
            , {$set: user}, function(err, result) {
                assert.equal(err, null);
                assert.equal(1, result.result.n);
                cb(result.result);
            });
    },
    remove: function(user, cb) {
        if(!this.ready) {
            return cb();
        }
        var collection = this.db.collection('users');
        collection.remove({channel: user.id}, function(err, result) {
            assert.equal(err, null);
            assert.equal(1, result.result.n);
            cb(result.result);
        });
    },
    load: function(cb) {
        var cursor = this.db.collection('users').find();
        var docs = [];
        cursor.each(function(err, doc) {
            assert.equal(err, null);
            if(doc != null) {
                docs.push(doc);
            } else {
                cb(docs);
            }
        });
    }
};

module.exports = DataBase;