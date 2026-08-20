* |
SELECT count(*) AS running_instances,
       coalesce(sum(active_connections), 0) AS connected_clients
FROM (
  SELECT installation_key,
         max_by(runtime_state, received_at_ms) AS runtime_state,
         max_by(active_connections, received_at_ms) AS active_connections,
         max(__time__) AS last_seen
  FROM log
  WHERE event_name IN ('session_started', 'presence_snapshot', 'session_ended')
  GROUP BY installation_key
)
WHERE runtime_state = 'online'
  AND last_seen > to_unixtime(now()) - 420
