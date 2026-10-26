// Polyfills first: the shared crypto needs crypto.getRandomValues, which Hermes does not have.
import './src/lib/polyfills'
import 'expo-router/entry'
