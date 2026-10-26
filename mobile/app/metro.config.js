// The app shares the companion protocol, crypto and translations with aFinder (../../src/shared).
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../src/shared')]
// Shared files resolve their packages (@noble/*) from this app too, e.g. in EAS builds without the root node_modules.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]
// aFinder's own React (desktop) sits in ../../node_modules: never let a shared file pull it into the app.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const desktopModules = escape(path.resolve(__dirname, '../../node_modules'))
config.resolver.blockList = [...[config.resolver.blockList ?? []].flat(), new RegExp(`^${desktopModules}[\\\\/](react|react-native|react-dom)[\\\\/]`)]
module.exports = config
