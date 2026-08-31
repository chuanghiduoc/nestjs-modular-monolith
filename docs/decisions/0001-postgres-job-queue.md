# Redis Job Queue

The default queue uses BullMQ on Redis. PostgreSQL stores business data and the
transactional outbox; it is not a job broker.

Move to Temporal or Trigger.dev when workflows need durable timers, human
approval, compensation or long-running state machines. Application code
depends on queue ports, so the adapter can be replaced with SQS, RabbitMQ,
Kafka, Temporal or Trigger.dev without changing a use case.
