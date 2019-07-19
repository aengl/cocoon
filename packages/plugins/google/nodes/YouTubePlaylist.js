import { google } from 'googleapis';
import _ from 'lodash';

/**
 * Queries video details from a YouTube playlist.
 *
 * Manage API keys at:
 * https://console.developers.google.com/apis/dashboard?project=cocoon
 *
 * API Documentation:
 * https://developers.google.com/youtube/v3/docs/
 */
export const YouTubePlaylist = {
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
    options: {
      hide: true,
      required: true,
    },
    playlist: {
      hide: true,
      required: true,
    },
  },

  out: {
    data: {},
  },

  async *process(context) {
    const { meta, omit, options, playlist: playlistId } = context.ports.read();
    const youtube = google.youtube(_.defaults(options, { version: 'v3' }));
    let data = [];
    let pageToken;
    context.debug(`querying videos for playlist "${playlistId}"`);
    while (true) {
      const result = await youtube.playlistItems.list({
        maxResults: 50,
        pageToken,
        part: 'id,snippet',
        playlistId,
      });
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
