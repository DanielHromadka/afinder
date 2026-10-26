import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import * as ScreenOrientation from 'expo-screen-orientation'
import { StatusBar } from 'expo-status-bar'
import { initLanguage, t } from '../lib/i18n'
import { loadComputers } from '../lib/store'
import { useColors } from '../lib/theme'

initLanguage()
void loadComputers()
// Upright everywhere except the screen viewer, which unlocks rotation for itself.
void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {})

/** Listings are cheap to ask again and change on the computer meanwhile: keep them briefly. */
const queries = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } })

export default function Layout(): React.JSX.Element {
  const c = useColors()
  return (
    <QueryClientProvider client={queries}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.accent,
          headerTitleStyle: { color: c.text },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.bg }
        }}
      >
        <Stack.Screen name="index" options={{ title: 'aFinder' }} />
        <Stack.Screen name="pair" options={{ title: t('mobile.pairComputer'), presentation: 'modal' }} />
        <Stack.Screen name="browse" options={{ title: '' }} />
        <Stack.Screen name="edit" options={{ title: '' }} />
        <Stack.Screen name="screen" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      </Stack>
    </QueryClientProvider>
  )
}
