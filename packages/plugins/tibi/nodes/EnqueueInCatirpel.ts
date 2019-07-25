import spawnChildProcess from '@cocoon/util/spawnChildProcess';
import fs from 'fs';
import yaml from 'js-yaml';
import _ from 'lodash';
import tmp from 'tmp';
import util from 'util';

const tmpNameAsync = util.promisify(tmp.tmpName);

/**
 * Extracts messages from data and enqueues them in Catirpel.
 */
export const EnqueueInCatirpel = {
  category: 'I/O',

  in: {
    data: {
      required: true,
    },
    message: {
      required: true,
      visible: false,
    },
    site: {
      required: true,
      visible: false,
    },
  },

  out: {
    messages: {},
  },

  async *process(context) {
    const { data, message, site } = context.ports.read();
    const time = Date.now();
    const messages = data.map((item, i) => {
      const url = interpolateTemplate(message.url, item);
      return _.assign({}, message, {
        // Give every message a unique ID, so we can enqueue duplicates of the
        // same message. If we didn't do this, we could only enqueue the
        // messages at most once per crawl since Catirpel ignores duplicates.
        id: time + i,
        url,
      });
    });
    const tempPath: string = await tmpNameAsync();
    await fs.promises.writeFile(tempPath, yaml.dump(messages));
    context.debug(`catirpel enqueue ${site} ${tempPath}`);
    await spawnChildProcess('catirpel', {
      args: ['enqueue', site, tempPath],
    });
    await fs.promises.unlink(tempPath);
    context.ports.write({ messages });
    return `Enqueued ${messages.length} messages for site "${site}"`;
  },
};

// https://stackoverflow.com/questions/30003353/
// tslint:disable:function-constructor
const interpolateTemplate = (templateString, templateVars) =>
  new Function('return `' + templateString + '`;').call(templateVars);
