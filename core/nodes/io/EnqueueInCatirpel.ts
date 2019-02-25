import yaml from 'js-yaml';
import _ from 'lodash';
import { NodeObject } from '../../../common/node';

export interface Message {
  url: string;
}

/**
 * Extracts messages from data and enqueues them in Catirpel.
 */
export const EnqueueInCatirpel: NodeObject = {
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
    const data = context.ports.read<object[]>('data');
    const message = context.ports.read<Message>('message');
    const site = context.ports.read<string>('site');
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
const interpolateTemplate = (templateString: string, templateVars: object) =>
  new Function('return `' + templateString + '`;').call(templateVars);
