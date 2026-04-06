CREATE TABLE invocations (
  id UUID PRIMARY KEY,
  parent UUID,
  predecessor UUID,
  run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,
  input JSONB NOT NULL,
  params JSONB NOT NULL,
  output JSONB,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE
);