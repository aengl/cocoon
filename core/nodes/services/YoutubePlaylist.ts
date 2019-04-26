import { google, youtube_v3 } from 'googleapis';
import _ from 'lodash';
import { CocoonNode } from '../../../common/node';

export interface Ports {
  meta: object;
  omit: string[];
  playlist: string;
}

/**
 * Queries video details from a Youtube playlist.
 *
 * Manage API keys at:
 * https://console.developers.google.com/apis/dashboard?project=cocoon
 *
 * API Documentation:
 * https://developers.google.com/youtube/v3/docs/
 */
export const YoutubePlaylist: CocoonNode<Ports> = {
  category: 'Services',

  in: {
    meta: {
      defaultValue: {},
      hide: true,
    },
    omit: {
      defaultValue: [],
      hide: true,
    },
    playlist: {
      hide: true,
      required: true,
    },
  },

  out: {
    data: {},
  },

  async process(context) {
    const { meta, omit, playlist: playlistId } = context.ports.read();
    const youtube = google.youtube({
      auth: 'AIzaSyC6hmoih05k0o_XTg3NPpClmqCCVgXQQCU',
      version: 'v3',
    });
    let items: youtube_v3.Schema$PlaylistItemSnippet[] = [];
    let pageToken;
    while (true) {
      context.debug(`querying videos for playlist "${playlistId}"`);
      const result = await youtube.playlistItems.list({
        maxResults: 50,
        pageToken,
        part: 'id,snippet',
        playlistId,
      });
      items = items.concat(
        result.data
          .items!.map(item =>
            omit ? _.omit(item.snippet!, omit) : item.snippet!
          )
          .map(item => _.assign({}, item, meta))
      );
      pageToken = result.data.nextPageToken;
      if (pageToken === undefined) {
        break;
      }
    }
    context.ports.write({ data: items });
    return `Found ${items.length} videos`;
  },
};
