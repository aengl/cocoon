import yaml from 'js-yaml';
import _ from 'lodash';

/**
 * Extracts messages from data and enqueues them in Catirpel.
 */
export const EnqueueInCatirpel = {
  category: 'Tibi',

  in: {
    data: {
      required: true,
    },
    message: {
      required: true,
      hide: true,
    },
    site: {
      required: true,
      hide: true,
    },
  },

  out: {
    messages: {},
  },

  async process(context) {
    const { fs, process } = context;
    const { data, message, site } = context.ports.read();
    const time = Date.now();
    const messages = data.map((item, i) => {
      const url = interpolateTemplate(message.url, item);
      return _.assign({}, message, {
        url,
        // Give every message a unique ID, so we can enqueue duplicates of the
        // same message. If we didn't do this, we could only enqueue the
        // messages at most once per crawl since Catirpel ignores duplicates.
        id: time + i,
      });
    });
    const tempPath = await fs.writeTempFile(yaml.dump(messages));
    context.debug(`catirpel enqueue ${site} ${tempPath}`);
    await process.runProcess('catirpel', {
      args: ['enqueue', site, tempPath],
    });
    await fs.removeFile(tempPath);
    context.ports.write({ messages });
    return `Enqueued ${messages.length} messages for site "${site}"`;
  },
};

// https://stackoverflow.com/questions/30003353/
// tslint:disable:function-constructor
const interpolateTemplate = (templateString, templateVars) =>
  new Function('return `' + templateString + '`;').call(templateVars);
