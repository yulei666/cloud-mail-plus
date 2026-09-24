export class EmailMessage {
  constructor(from, to, rawMime) {
    this.from = from;
    this.to = to;
    this.rawMime = rawMime;
  }
}
