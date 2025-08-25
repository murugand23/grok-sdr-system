// Tool type definitions
export interface GrokToolParameters {
  type: 'object';
  properties: {
    [key: string]: {
      type: string;
      description?: string;
      enum?: string[];
      items?: any;
    };
  };
  required?: string[];
}

export interface GrokTool {
  name: string;
  description: string;
  parameters: GrokToolParameters;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface ToolCall {
  tool: string;
  parameters: any;
}