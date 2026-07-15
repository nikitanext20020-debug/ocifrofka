import { describe, expect, it } from "vitest";
import { parseRecognitionSession } from "@/lib/recognition-session";

describe("parseRecognitionSession", () => {
  it("imports a previously exported recognition session and regenerates ids", () => {
    const records = parseRecognitionSession([
      {
        id: "old-id",
        topic: "Благоустройство",
        full_name: "Иванов Иван Иванович",
        birth_date: "01.01.1990",
        address: "Ногинск",
        phone: "79990000000",
        confidence_notes: "",
        sourceName: "page-1.jpg",
        thumbnail: "data:image/jpeg;base64,AAAA",
      },
    ], () => "new-id");

    expect(records).toEqual([{
      id: "new-id",
      topic: "Благоустройство",
      full_name: "Иванов Иван Иванович",
      birth_date: "01.01.1990",
      address: "Ногинск",
      phone: "79990000000",
      confidence_notes: "",
      sourceName: "page-1.jpg",
      thumbnail: "data:image/jpeg;base64,AAAA",
    }]);
  });

  it("accepts a records wrapper and supplies missing display metadata", () => {
    const records = parseRecognitionSession({
      records: [{
        topic: "Дороги",
        full_name: "Петров Петр Петрович",
        birth_date: "-",
        address: "-",
        phone: "-",
      }],
    }, () => "generated-id");

    expect(records[0]).toMatchObject({
      id: "generated-id",
      confidence_notes: "",
      sourceName: "Импортированная запись 1",
      thumbnail: "",
    });
  });

  it("rejects unrelated JSON", () => {
    expect(() => parseRecognitionSession({ hello: "world" }, () => "id")).toThrow();
  });
});
