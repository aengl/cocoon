const yaml = require('js-yaml');
const _ = require('lodash');

/**
 * Extracts messages from data and enqueues them in Catirpel.
 */
module.exports.EnqueueInCatirpel = {
  category: 'I/O',

  in: {
    data: {
      required: true,
    },
    message: {
      required: true,
    },
    site: {
      required: true,
    },
  },

  out: {
    messages: {},
  },

  async process(context) {
    const { fs, process } = context;
    const { data, message, site } = context.ports.readAll();
    const messages = data.map(item => {
      const url = interpolateTemplate(message.url, item);
      return _.assign({}, message, { url });
    });
    const tempPath = await fs.writeTempFile(yaml.dump(messages));
    await process.runProcess('catirpel', {
      args: ['enqueue', site, tempPath],
    });
    await fs.removeFile(tempPath);
    context.ports.writeAll({ messages });
    return `Enqueued ${messages.length} messages for site "${site}"`;
  },
};

// https://stackoverflow.com/questions/30003353/
// tslint:disable:function-constructor
const interpolateTemplate = (templateString, templateVars) =>
  new Function('return `' + templateString + '`;').call(templateVars);
