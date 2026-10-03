// Exercise the actual SearchService and Windows notifications on the disk
// backend, with its persisted store deliberately inside the indexed root.
process.env.ONE_SEARCH_BACKEND='disk';
require('./index-watch-native.cjs');
