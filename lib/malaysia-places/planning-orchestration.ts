import 'server-only';

import {
  createPlanningIntelligencePlan,
  type PlanningRouteValidator,
} from './planning-orchestration-core';
import { validateScheduleWithOpenRouteService } from './route-validation';

export * from './planning-orchestration-core';

export async function createServerPlanningIntelligencePlan(
  input: Omit<
    Parameters<typeof createPlanningIntelligencePlan>[0],
    'routeValidator'
  > & { validateRoutes: boolean },
) {
  const routeValidator: PlanningRouteValidator | undefined =
    input.validateRoutes
      ? (validationInput) =>
          validateScheduleWithOpenRouteService(validationInput)
      : undefined;
  return createPlanningIntelligencePlan({ ...input, routeValidator });
}
