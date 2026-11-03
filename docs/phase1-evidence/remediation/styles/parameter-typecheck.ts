import type {StyleParameterRule,StyleParametersSchema} from '../../../../src/styles/index.js';
const count:StyleParameterRule={type:'integer',minimum:0,maximum:5,default:1,enum:[0,1,5]};
const ratio:StyleParameterRule={type:'number',minimum:0,maximum:1,default:.25};
const enabled:StyleParameterRule={type:'boolean',default:false,enum:[false,true]};
const label:StyleParameterRule={type:'string',default:'ink',description:'Label',enum:['ink','paper']};
const schema:StyleParametersSchema={type:'object',additionalProperties:false,properties:{count,ratio,enabled,label}};
// @ts-expect-error Object rules are unsupported; do not silently ignore them.
const unsupported:StyleParameterRule={type:'object'};
// @ts-expect-error Boolean rules cannot default to a number.
const wrongDefault:StyleParameterRule={type:'boolean',default:1};
// @ts-expect-error Numeric bounds apply only to numeric rule types.
const wrongBounds:StyleParameterRule={type:'string',minimum:0};
// @ts-expect-error Enum primitives must match their rule type.
const wrongEnum:StyleParameterRule={type:'integer',enum:['1']};
void [schema,unsupported,wrongDefault,wrongBounds,wrongEnum];
