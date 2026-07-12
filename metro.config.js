const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

const sep = path.sep === '\\' ? '\\\\' : '\\/';
const tfliteNative = (folder) =>
  new RegExp(`react-native-fast-tflite${sep}${folder}${sep}.*`);

const config = {
  resolver: {
    assetExts: [...defaultConfig.resolver.assetExts, 'tflite'],
    blockList: [
      tfliteNative('android'),
      tfliteNative('ios'),
      tfliteNative('cpp'),
      tfliteNative('nitrogen'),
    ],
  },
};

module.exports = mergeConfig(defaultConfig, config);
