event_name: session_started |
SELECT date_format(from_unixtime(__time__), '%Y-%m-%d') AS day,
       approx_distinct(event_id) AS sessions
GROUP BY day
ORDER BY day
