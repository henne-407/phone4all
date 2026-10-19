/*
 * pa-devices: listet die PortAudio-Audiogeräte als JSON (für macOS/Windows).
 *
 * Die Namen entsprechen denen, die baresips portaudio-Modul erwartet
 * ("<Host-API>: <Gerät>"); SIP-Telefon setzt sie aus "hostapi" und "name" zusammen.
 *
 *   [{"name": "...", "hostapi": "Core Audio", "inputs": 1, "outputs": 0,
 *     "defaultInput": true, "defaultOutput": false}, ...]
 */

#include <portaudio.h>
#include <stdio.h>

static void json_string(const char *s)
{
	putchar('"');
	for (; s && *s; s++) {
		unsigned char c = (unsigned char)*s;
		if (c == '"' || c == '\\')
			printf("\\%c", c);
		else if (c < 0x20)
			printf("\\u%04x", c);
		else
			putchar(c);
	}
	putchar('"');
}

int main(void)
{
	int i, n, first = 1;

	/* PortAudio schreibt beim Initialisieren manchmal auf stderr */
	if (Pa_Initialize() != paNoError) {
		puts("[]");
		return 1;
	}

	n = Pa_GetDeviceCount();
	putchar('[');
	for (i = 0; i < n; i++) {
		const PaDeviceInfo *dev = Pa_GetDeviceInfo(i);
		const PaHostApiInfo *api;
		if (!dev)
			continue;
		api = Pa_GetHostApiInfo(dev->hostApi);
		if (!api)
			continue;

		if (!first)
			putchar(',');
		first = 0;
		printf("{\"name\":");
		json_string(dev->name);
		printf(",\"hostapi\":");
		json_string(api->name);
		printf(",\"inputs\":%d,\"outputs\":%d", dev->maxInputChannels, dev->maxOutputChannels);
		printf(",\"defaultInput\":%s,\"defaultOutput\":%s}",
		       api->defaultInputDevice == i ? "true" : "false",
		       api->defaultOutputDevice == i ? "true" : "false");
	}
	puts("]");

	Pa_Terminate();
	return 0;
}
