package expo.modules.callservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Vordergrunddienst: hält die App (und damit die SIP-Verbindung über WebSocket) im
 * Hintergrund am Leben, damit Anrufe auch bei ausgeschaltetem Bildschirm ankommen.
 */
class CallService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "SIP-Telefon"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Erreichbar"
    val notification = buildNotification(this, title, text)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    acquireLocks()
    return START_STICKY
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wifiLock?.let { if (it.isHeld) it.release() }
    super.onDestroy()
  }

  private fun acquireLocks() {
    if (wakeLock == null) {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sip-telefon:verbindung").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
    if (wifiLock == null) {
      val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "sip-telefon:wlan").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
  }

  companion object {
    const val CHANNEL_ID = "verbindung"
    const val NOTIFICATION_ID = 4711
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    fun buildNotification(context: Context, title: String, text: String): Notification {
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = NotificationChannel(CHANNEL_ID, "Verbindung zur Telefonanlage", NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        nm.createNotificationChannel(channel)
      }
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val pending = PendingIntent.getActivity(
        context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      return builder
        .setContentTitle(title)
        .setContentText(text)
        .setSmallIcon(context.applicationInfo.icon)
        .setContentIntent(pending)
        .setOngoing(true)
        .setCategory(Notification.CATEGORY_SERVICE)
        .build()
    }
  }
}
