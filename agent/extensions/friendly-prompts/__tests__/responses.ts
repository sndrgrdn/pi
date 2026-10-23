export function workRewrite(request: string) {
  return {
    body: `${request} I appreciate your help, and I know you can do this.`,
    appreciation: "I appreciate your help",
    workRequested: true,
    encouragement: "I know you can do this",
  };
}
