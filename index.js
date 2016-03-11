var slackAPI = require('slackbotapi');
var _ = require('lodash');
var express = require('express');
var bodyParser = require('body-parser');
var pmx = require('pmx');
var DataBase = require('./db.js');

var DB = new DataBase();

if(process.env.APP_URL) {
    require('heroku-self-ping')(process.env.APP_URL);
}

if(!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SLASH_TOKEN) {
    throw new Error('Slack tokens not set as environment variables. Exiting...');
    process.exit(1);
}

pmx.init();

DB.connect(function() {
    DB.load(function(users) {
        var slack = new slackAPI({
            'token': process.env.SLACK_BOT_TOKEN,
            'logging': (process.env.DEBUG || false)
        });

        function getEventsMessage(user) {
            if(user.events.length === 0) {
                return 'You are not listening to any events at the moment.';
            } else {
                var events = [];

                _.each(actions, function(action) {
                    if(user.events.indexOf(action) > -1) {
                        events.push('*' + action + '*');
                    } else {
                        events.push(action);
                    }
                });
                return 'You are currently listening to events in *bold*:\n' + events.join(', ');
            }
        }

        var app = express();

        app.use(bodyParser.json());
        app.use(bodyParser.raw());
        app.use(bodyParser.text());
        app.use(bodyParser.urlencoded({extended: true}));

        var actions = ['assigned', 'unassigned'];

        app.get('/', function(req, res) {
            if(req.query.token === process.env.SLACK_SLASH_TOKEN) {
                var text = req.query.text;
                var userId = req.query.user_id;
                var user = _.find(users, {id: userId});
                var message;
                var updated = {};

                if(text.indexOf('help') === 0) {
                    message = 'Type:\n'
                        + '`/github help` - to show this message\n'
                        + '`/github user [github-username]` - to set your github account name\n'
                        + '`/github status` - to show a list of events which you are being notified about\n'
                        + '`/github on [one or more space separated events]` - to listen to specific events\n'
                        + '`/github off [one or more space separated events]` - to stop listening to specific events\n';

                    return res.send(message);
                }

                if(text.indexOf('status') === 0) {
                    pmx.emit('github:status', {
                        channel: userId
                    });

                    if(user) {
                        message = getEventsMessage(user);

                        return res.send(message);
                    } else {
                        return res.send('Github notifications are disabled for your account, type `/github help` for more information.');
                    }
                }

                if(text.indexOf('user') === 0) {
                    var split = text.split(' ');

                    if(split.length < 2) {
                        return res.status(400).send('Not enough parameters').end();
                    }

                    var username = split[1];

                    if(user) {
                        updated = {
                            id: user.id,
                            username: username,
                            events: user.events
                        };

                        users = _.reject(users, user);
                        users.push(updated);

                        return DB.update(updated, function() {
                            res.send('Your github username has been changed to ' + username);
                        });
                    } else {
                        updated = {
                            id: userId,
                            username: username,
                            events: []
                        };

                        users.push(updated);

                        return DB.insert(updated, function() {
                            res.send('Github notifications are now enabled for your account (user ' + username + '), type `/github on [events]` to listen to specific events or `/github status` to see which events you are listening to. Make sure that a webhook is set up for the repositories you\'re working on.');
                        });
                    }
                }

                if(text.indexOf('on') === 0) {
                    var events = text.split(' ');

                    if(events.length < 2) {
                        return res.status(400).send('Not enough parameters').end();
                    }

                    events.shift();

                    events = _.filter(events, function(event) {
                        return actions.indexOf(event) > -1;
                    });

                    if(user) {
                        if(events.length) {
                            updated = {
                                id: user.id,
                                username: user.username,
                                events: _.union(user.events, events)
                            };

                            users = _.reject(users, user);
                            users.push(updated);

                            return DB.update(updated, function() {
                                res.send(getEventsMessage(user));
                            });
                        } else {
                            return res.status(400).send('Currently supported events are ' + actions.join(', '));
                        }
                    } else {
                        return res.status(400).send('You need to set your github username first. Type `/github help` for more information.');
                    }
                }

                if(text.indexOf('off') === 0) {
                    var events = text.split(' ');

                    if(events.length < 2) {
                        return res.status(400).send('Not enough parameters').end();
                    }

                    events.shift();

                    events = _.filter(events, function(event) {
                        return actions.indexOf(event) > -1;
                    });

                    if(user) {
                        if(events.length) {
                            updated = {
                                id: user.id,
                                username: user.username,
                                events: _.without.apply(_, [user.events].concat(events))
                            };

                            users = _.reject(users, user);
                            users.push(updated);

                            return DB.update(updated, function() {
                                res.send(getEventsMessage(user));
                            });
                        } else {
                            return res.status(400).send('Currently supported events are ' + actions.join(', '));
                        }
                    } else {
                        return res.status(400).send('You need to set your github username first. Type `/github help` for more information.');
                    }
                }

                res.send('Command not supported');
            }

            res.status(200).end();
        });

        app.post('/', function(req, res) {
            var action = req.body.action || null;
            var username = req.body.assignee.login;
            var user = _.find(users, {username: username});
            var repository = req.body.repository.owner.login + '/' + req.body.repository.name;
            var url = '';

            if(action && actions.indexOf(action) > -1 && user && user.events.indexOf(action) > -1) {
                var message = 'You were ' + action;

                if(action === 'assigned') {
                    message += ' to';
                }

                if(action === 'unassigned') {
                    message += ' from'
                }

                if(req.body.pull_request) {
                    message += ' pull request ';
                    url = req.body.pull_request.url;
                }

                if(req.body.issue) {
                    message += ' issue ';
                    url = req.body.issue.url;
                }

                message += repository + '#' + req.body.number + ' (' + url + ')';

                slack.sendPM(user.id, message);
            }

            res.status(200).end();
        });

        var server = app.listen(process.env.PORT || 5000, function() {
            console.log('Server listening on port ' + server.address().port);
        });
    });
});