// Native objects supplied by NotePlan to the plugin script.
interface NotePlanParagraph {
  content: string;
  type: string;
  indents: number;
  lineIndex: number;
  fileLineIndex?: number;
  headingLevel?: number;
  blockId?: string;
  duplicate?(): NotePlanParagraph;
}

interface NotePlanNote {
  filename: string;
  title: string;
  type: string;
  frontmatterAttributes?: Record<string, unknown>;
}

declare const Editor: {
  note: NotePlanNote | null;
  content: string;
  paragraphs: NotePlanParagraph[];
  selectedParagraphs: NotePlanParagraph[];
  addBlockID?(paragraph: NotePlanParagraph): void;
  removeBlockID?(paragraph: NotePlanParagraph): void;
  updateParagraph?(paragraph: NotePlanParagraph): void;
  insertParagraphAfterParagraph?(
    content: string,
    paragraph: NotePlanParagraph,
    type: string,
  ): void;
  save?(): Promise<void>;
};

declare const DataStore: {
  settings?: {
    unestimatedSessionDuration?: string;
    unestimatedSessionTitle?: string;
  };
  preference?(key: string): string | null | undefined;
};

declare const NotePlan: {
  openURL?(url: string): Promise<void>;
};

declare const CommandBar: {
  prompt?(title: string, message: string, buttons: string[]): Promise<number>;
  textPrompt?(
    title: string,
    message: string,
    defaultText?: string,
  ): Promise<string | false>;
  showForm?(options: {
    title: string;
    submitText?: string;
    fields: Array<{
      type: "string";
      key: string;
      title: string;
      placeholder?: string;
      description?: string;
    }>;
  }): Promise<{ submitted: boolean; values: Record<string, string> }>;
};
