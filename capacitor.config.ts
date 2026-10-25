import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.raheelshah.taskly',
  appName: 'Taskly',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#0e7490',
      androidScaleType: 'CENTER_INSIDE',
    },
    LocalNotifications: { smallIcon: 'ic_stat_taskly', iconColor: '#0e7490' },
    CapacitorUpdater: {
      autoUpdate: 'atBackground',
      appReadyTimeout: 10000,
      autoDeleteFailed: true,
      autoDeletePrevious: false,
    },
  },
}

export default config
