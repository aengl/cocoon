import { google, youtube_v3 } from 'googleapis';
import _ from 'lodash';
import { NodeObject } from '../../../common/node';

/**
 * Queries video details from a Youtube playlist.
 *
 * Manage API keys at:
 * https://console.developers.google.com/apis/dashboard?project=cocoon
 *
 * API Documentation:
 * https://developers.google.com/youtube/v3/docs/
 */
export const YoutubePlaylist: NodeObject = {
  category: 'Services',

  in: {
    omit: {
      defaultValue: ['position'],
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
    const omit = context.ports.read<string[]>('omit');
    const playlistId = context.ports.read<string>('playlist');
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
        result.data.items!.map(item =>
          omit ? _.omit(item.snippet!, omit) : item.snippet!
        )
      );
      pageToken = result.data.nextPageToken;
      if (pageToken === undefined) {
        break;
      }
    }
    context.ports.writeAll({ data: items });
  },
};
