* |
SELECT app_version, count(*) AS installations
FROM (
  SELECT installation_key,
         max_by(app_version, received_at_ms) AS app_version,
         max(__time__) AS last_seen
  FROM log
  GROUP BY installation_key
)
WHERE last_seen > to_unixtime(now()) - 86400
GROUP BY app_version
ORDER BY installations DESC
