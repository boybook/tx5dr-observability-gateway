# Anonymous usage statistics

TX-5DR sends no observability data until an administrator has seen and accepted the in-product notice. The administrator can leave the default enabled, turn it off before accepting, or disable it later.

The telemetry service receives a random installation identifier, application version, release channel, build commit, distribution type, operating-system family, CPU architecture, process lifecycle events, uptime, and the number of completed WebSocket connections. The service converts the random identifier to a keyed HMAC before storing it.

It does not accept or store callsigns, grid locators, QSO records, frequencies, audio, radio models, serial numbers, host names, user names, paths, URLs, tokens, raw IP addresses, user agents, or log content. Alibaba Cloud necessarily processes network metadata while delivering HTTPS requests, but the application does not copy source IPs into product telemetry.

Telemetry events are stored in Alibaba Cloud Log Service in Hangzhou for 180 days. Installation registration records are retained for up to 3,650 days so aggregate installation counts remain meaningful. Runtime logs are retained for 30 days.

The resulting figures describe participating installations and browser connections. They do not identify or reliably count natural persons, downloads, or purchases.
