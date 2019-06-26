import { CocoonNode } from '@cocoon/types';
import got from 'got';

export interface Ports {
  attributes: string[];
  data: object[];
}

/**
 * Resolves the target URL of a shortened URL.
 */
export const UnshortenURLs: CocoonNode<Ports> = {
  category: 'Services',

  in: {
    attributes: {
      hide: true,
      required: true,
    },
    data: {
      clone: true,
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { attributes, data } = context.ports.read();
    let numResolved = 0;
    for (const item of data) {
      await Promise.all(
        attributes.map(async attr => {
          const url = item[attr];
          if (url !== undefined) {
            const result = await got(url, {
              followRedirect: false,
            });
            const targetUrl = result.headers.location || result.url;
            context.debug(`resolved "${url}" to "${targetUrl}"`);
            item[attr] = targetUrl;
            numResolved += 1;
          }
        })
      );
    }
    context.ports.write({ data });
    return `Resolved ${numResolved} URLs`;
  },
};
