import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { trace } from '@opentelemetry/api';
import { initAxiomAI, RedactionPolicy } from 'axiom/ai';
import type { AxiomEvalInstrumentationHook } from 'axiom/ai/config';

let provider: NodeTracerProvider | undefined;

export const setupInstrumentation: AxiomEvalInstrumentationHook = async (options) => {
  if (provider) return { provider };

  const { url, token, dataset, orgId } = options;

  const exporter = new OTLPTraceExporter({
    url: `${url}/v1/traces`,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Axiom-Dataset': dataset,
      ...(orgId ? { 'X-AXIOM-ORG-ID': orgId } : {}),
    },
  });

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'my-app-evals' }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  provider.register();
  initAxiomAI({ tracer: trace.getTracer('my-app-tracer'), redactionPolicy: RedactionPolicy.AxiomDefault });

  return { provider };
};
