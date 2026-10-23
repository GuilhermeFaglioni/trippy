import { createSample25DryRunPlan } from './sample-25-plan.ts'
import { sample25 } from './sample-25.ts'

console.log(JSON.stringify(createSample25DryRunPlan(sample25), null, 2))
