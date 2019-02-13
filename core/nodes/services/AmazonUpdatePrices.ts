// import paapi from 'amazon-product-api';
// import Bottleneck from 'bottleneck';
// import _ from 'lodash';
// import { NodeObject } from '../../../common/node';

// const itemsPerRequest = 10;
// const requestInterval = 1000;

// export const AmazonUpdatePrices: NodeObject = {
//   in: {
//     data: {
//       required: true,
//     },
//   },

//   out: {
//     data: {},
//   },

//   async process(context) {
//     const data = context.cloneFromPort<object[]>('data');
//     const limiter = new Bottleneck({ minTime: requestInterval });
//     const client = paapi.createClient({
//       awsId: 'AKIAJR6FQEFUJ4DSBVRA',
//       awsSecret: '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',
//       awsTag: 'titv0f-21',
//     });
//     let numPricesUpdated = 0;
//     for (let i = 0; i < data.length; i += itemsPerRequest) {
//       const items = data.slice(i, i + itemsPerRequest);
//       const prices = await limiter.schedule(() => fetchPrices(client, items));
//       items.forEach((item, j) => {
//         const newPrice = prices[j];
//         const oldPrice = _.get(item, 'amazon_price');
//         if (newPrice !== oldPrice) {
//           numPricesUpdated += 1;
//           context.debug(
//             `price changed (${oldPrice} -> ${newPrice})`,
//             `https://amazon.de/dp/${_.get(item, 'asin')}`
//           );
//         }
//       });
//       context.progress(`updated ${numPricesUpdated} prices`);
//     }
//     context.writeToPort<object[]>('data', data);
//     return `updated ${numPricesUpdated} prices`;
//   },
// };

// async function fetchPrices(
//   client: paapi.IAmazonProductClient,
//   items: object[]
// ) {
//   const itemIds = items.map(item => _.get(item, 'asin'));
//   if (itemIds.some(id => id === undefined)) {
//     throw new Error(`one or more items had no "asin" attribute`);
//   }
//   const results = await client.itemLookup({
//     domain: 'webservices.amazon.de',
//     itemId: itemIds,
//     responseGroup: 'ItemAttributes,Offers,Images',
//   });
//   return results
//     .map(x => _.get(x, 'OfferSummary[0].LowestNewPrice[0].Amount[0]'))
//     .map(x => parseInt(x, 10))
//     .map(x => (_.isNaN(x) ? undefined : x));
// }
