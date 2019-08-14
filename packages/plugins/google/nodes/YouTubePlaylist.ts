import { CocoonNode } from '@cocoon/types';
import { google, youtube_v3 } from 'googleapis';
import _ from 'lodash';

export interface Ports {
  meta: object;
  omit: string[];
  options: youtube_v3.Options;
  playlist: string;
}

/**
 * Queries video details from a YouTube playlist.
 *
 * Manage API keys at:
 * https://console.developers.google.com/apis/dashboard?project=cocoon
 *
 * API Documentation:
 * https://developers.google.com/youtube/v3/docs/
 */
export const YouTubePlaylist: CocoonNode<Ports> = {
  category: 'Services',

  in: {
    meta: {
      defaultValue: {},
      visible: false,
    },
    omit: {
      defaultValue: [],
      visible: false,
    },
    options: {
      required: true,
      visible: false,
    },
    playlist: {
      required: true,
      visible: false,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const { meta, omit, options, playlist: playlistId } = context.ports.read();
    const youtube = google.youtube(_.defaults(options, { version: 'v3' }));
    let data: any[] = [];
    let pageToken;
    context.debug(`querying videos for playlist "${playlistId}"`);
    while (true) {
      const result = await youtube.playlistItems.list({
        maxResults: 50,
        pageToken,
        part: 'id,snippet',
        playlistId,
      });
      if (!result.data.items) {
        throw new Error(`playlist "${playlistId}" not found`);
      }
      data = data.concat(
        result.data.items
          .map(item => (omit ? _.omit(item.snippet, omit) : item.snippet))
          .map(item => _.assign({}, item, meta))
      );
      pageToken = result.data.nextPageToken;
      if (pageToken === undefined) {
        break;
      }
      yield `Found ${data.length} videos`;
    }
    context.ports.write({ data });
    return `Found ${data.length} videos`;
  },
};
