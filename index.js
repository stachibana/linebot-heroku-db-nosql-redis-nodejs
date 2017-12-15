'use strict';

const line = require('@line/bot-sdk');
const express = require('express');

// create LINE SDK config from env variables
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// create LINE SDK client
const client = new line.Client(config);

// create Express app
// about Express itself: https://expressjs.com/
const app = express();

var r = require('redis').createClient(process.env.REDIS_URL);

// register a webhook handler with middleware
// about the middleware, please refer to doc
app.post('/', line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result));
});

function notifyBlankField(event) {

  r.hkeys(event.source.userId, function (err, obj) {
    const required = ['lat', 'lon', 'url', 'comment', 'review'];
    const done = obj;

    const blank = required.filter(function(x) { return done.indexOf(x) < 0 })

    if(blank.length == 0) {
      r.hset(event.source.userId, 'userid', event.source.userId);
      r.rename(event.source.userId, 'lm_' + require('uuid').v4());
      const array = [{
        type: 'text',
        text: 'added landmark. You can egister another landmark or view all data by sending \'show\''
      }];
      return client.replyMessage(event.replyToken, array);
    } else {
      const array = [{
        type: 'text',
        text: 'saved. required: ' + blank.join(', ')
      }];
      return client.replyMessage(event.replyToken, array);
    }
  });
}

// event handler
function handleEvent(event) {

  if (event.type === 'message' && event.message.type === 'text') {
    if(event.message.text == 'show') {
      var text = 'fuck';
      var all_parts = {};
      r.keys("lm_*", function(err, keys) {
        var count = keys.length;
        keys.forEach( function(key) {
          r.hgetall(key, function(err, obj) {
            all_parts[key] = obj;
            --count;
            if (count <= 0) {
              const array = [{
                type: 'text',
                text: JSON.stringify(all_parts)
              }];
              return client.replyMessage(event.replyToken, array);
            }
          });
        });
      });
    }
    else {
      r.hget(event.source.userId, 'tmp', function(err, obj) {
        if(obj != null && ['comment', 'review'].includes(event.message.text)) {
          r.hset(event.source.userId, event.message.text, obj);
          r.hdel(event.source.userId, 'tmp');
          notifyBlankField(event);
        } else {
          r.hset(event.source.userId, 'tmp', event.message.text);
          return client.replyMessage(
            event.replyToken,
            {
              type: 'template',
              altText: 'Alternative Text',
              template: {
                type: 'buttons',
                text: `Which field to store '${event.message.text}'?`,
                actions: [
                  { label: 'comment', type: 'message', text: 'comment' },
                  { label: 'review', type: 'message', text: 'review' },
                ],
              },
            }
          );
        }
      });
    }
  }
  else if (event.type === 'message' && event.message.type === 'image') {
    const contentStream = client.getMessageContent(event.message.id);

    var uuid = require('uuid');
    const fileName = uuid.v4();

    const fs = require('fs');
    fs.mkdir('tmp', function (err) {});

    var writeStream = fs.createWriteStream('tmp/' + fileName + '.jpg', { flags : 'w' });
    contentStream.pipe(writeStream);

    writeStream.on('close', function () {
      const cloudinary = require('cloudinary');
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_NAME,
        api_key: process.env.CLOUDINARY_KEY,
        api_secret: process.env.CLOUDINARY_SECRET
      });
      cloudinary.uploader.upload('tmp/' + fileName + '.jpg', function(result) {
        r.hset(event.source.userId, 'url', result['secure_url']);
        notifyBlankField(event);
      });
    });
  }
  else if (event.type === 'message' && event.message.type === 'location') {
    const lat = event.message.latitude;
    const lon = event.message.longitude

    r.hmset(event.source.userId, {'lat': lat, 'lon': lon});
    notifyBlankField(event)
  }
}

// listen on port
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`listening on ${port}`);
});
