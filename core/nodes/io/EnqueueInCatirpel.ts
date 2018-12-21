import yaml from 'js-yaml';
import _ from 'lodash';
import { NodeObject } from '../../../common/node';
import { runProcess } from '../../../common/process';
import { removeFile, writeTempFile } from '../../fs';

export interface Message {
  url: string;
}

/**
 * Extracts messages from data and enqueues them in Catirpel.
 */
const EnqueueInCatirpel: NodeObject = {
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
    const data = context.readFromPort<object[]>('data');
    const message = context.readFromPort<Message>('message');
    const site = context.readFromPort<string>('site');
    const messages = data.map(item => {
      const url = interpolateTemplate(message.url, item);
      return _.assign({}, message, { url });
    });
    const tempPath = await writeTempFile(yaml.dump(messages));
    await runProcess('catirpel', ['enqueue', site, tempPath]);
    await removeFile(tempPath);
    context.writeToPort('messages', messages);
    return `Enqueued ${messages.length} messages for site "${site}"`;
  },
};

export { EnqueueInCatirpel };

// https://stackoverflow.com/questions/30003353/
const interpolateTemplate = (templateString: string, templateVars: object) =>
  new Function('return `' + templateString + '`;').call(templateVars);
