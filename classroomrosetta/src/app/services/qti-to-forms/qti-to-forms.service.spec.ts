import {provideHttpClient} from '@angular/common/http';
import {TestBed} from '@angular/core/testing';
import {AuthService} from '../auth/auth.service';
import {FileUploadService} from '../file-upload/file-upload.service';
import {UtilitiesService} from '../utilities/utilities.service';
import {QtiToFormsService} from './qti-to-forms.service';

describe('QtiToFormsService', () => {
  let service: QtiToFormsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        {provide: AuthService, useValue: {getGoogleAccessToken: () => 'test-token'}},
        {provide: FileUploadService, useValue: {}},
        {
          provide: UtilitiesService,
          useValue: {
            getDirectory: (path: string) => path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '',
            getBasename: (path: string) => path.split('/').pop() || '',
            tryDecodeURIComponent: (value: string) => {
              let result = value;
              for (let index = 0; index < 5; index++) {
                const decoded = decodeURIComponent(result.replace(/\+/g, ' '));
                if (decoded === result) break;
                result = decoded;
              }
              return result;
            }
          }
        }
      ]
    });
    service = TestBed.inject(QtiToFormsService);
  });

  it('splits Canvas compound questions into one-point questions and resolves prompt images', () => {
    const qti = `<?xml version="1.0"?>
      <questestinterop>
        <assessment title="Compound quiz">
          <section>
            <item ident="item1" title="Compound">
              <itemmetadata><qtimetadata>
                <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_dropdowns_question</fieldentry></qtimetadatafield>
                <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>8</fieldentry></qtimetadatafield>
              </qtimetadata></itemmetadata>
              <presentation>
                <material><mattext texttype="text/html">&lt;p&gt;Use the diagram.&lt;/p&gt;&lt;img src="$IMS-CC-FILEBASE$/assessment_questions/diagram.png?canvas_download=1"&gt;&lt;p&gt;First [CLOZE_01], second [CLOZE_02].&lt;/p&gt;</mattext></material>
                <response_lid ident="response_CLOZE_01"><material><mattext>CLOZE_01</mattext></material><render_choice>
                  <response_label ident="a"><material><mattext>A</mattext></material></response_label>
                  <response_label ident="b"><material><mattext>B</mattext></material></response_label>
                </render_choice></response_lid>
                <response_lid ident="response_CLOZE_02"><material><mattext>CLOZE_02</mattext></material><render_choice>
                  <response_label ident="c"><material><mattext>C</mattext></material></response_label>
                  <response_label ident="d"><material><mattext>D</mattext></material></response_label>
                </render_choice></response_lid>
              </presentation>
              <resprocessing>
                <respcondition><conditionvar><varequal respident="response_CLOZE_01">b</varequal></conditionvar><setvar>100</setvar></respcondition>
                <respcondition><conditionvar><varequal respident="response_CLOZE_02">d</varequal></conditionvar><setvar>100</setvar></respcondition>
              </resprocessing>
            </item>
          </section>
        </assessment>
      </questestinterop>`;
    const image = {name: 'assessment_questions/diagram.png', data: new ArrayBuffer(1), mimeType: 'image/png'};
    const parsed = (service as any).parseCanvasQti(
      {name: 'quiz/quiz.xml', data: qti, mimeType: 'text/xml'},
      [image]
    );

    expect(parsed.items.length).toBe(2);
    expect(parsed.items[0].question.choiceQuestion.type).toBe('DROP_DOWN');
    expect(parsed.items[0].question.grading.pointValue).toBe(1);
    expect(parsed.items[1].question.grading.pointValue).toBe(1);
    expect(parsed.items[0].image.file).toBe(image);
    expect(parsed.items[0].question.grading.correctAnswers.answers[0].value).toBe('B');
    expect(parsed.items[1].question.grading.correctAnswers.answers[0].value).toBe('D');
  });

  it('preserves images embedded in answer choices', () => {
    const qti = `<?xml version="1.0"?>
      <questestinterop><assessment><section><item>
        <itemmetadata><qtimetadata><qtimetadatafield>
          <fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry>
        </qtimetadatafield></qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Choose the cell.&lt;/p&gt;</mattext></material>
          <response_lid ident="response1"><render_choice>
            <response_label ident="a"><material><mattext texttype="text/html">&lt;img src="$IMS-CC-FILEBASE$/answers/cell.png"&gt;</mattext></material></response_label>
            <response_label ident="b"><material><mattext>None</mattext></material></response_label>
          </render_choice></response_lid>
        </presentation>
        <resprocessing><respcondition><conditionvar><varequal respident="response1">a</varequal></conditionvar><setvar>100</setvar></respcondition></resprocessing>
      </item></section></assessment></questestinterop>`;
    const image = {name: 'answers/cell.png', data: new ArrayBuffer(1), mimeType: 'image/png'};
    const parsed = (service as any).parseCanvasQti(
      {name: 'quiz.xml', data: qti, mimeType: 'text/xml'},
      [image]
    );

    expect(parsed.items[0].optionImages.get('Option 1').file).toBe(image);
    expect(parsed.items[0].question.grading.correctAnswers.answers[0].value).toBe('Option 1');

    const formItem = (service as any).toFormItem(parsed.items[0], new Map([
      [image.name, {sourceUri: 'https://example.com/cell.png'}]
    ]));
    expect(formItem.questionItem.question.choiceQuestion.options[0].image.properties.alignment).toBe('LEFT');
  });

  it('converts duplicate Canvas placeholder answers into a paragraph response', () => {
    const qti = `<?xml version="1.0"?>
      <questestinterop><assessment><section><item title="Lab response">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
          <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>1</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Record your lab observations.&lt;/p&gt;</mattext></material>
          <response_lid ident="response1"><render_choice>
            <response_label ident="a"><material><mattext>No answer text provided.</mattext></material></response_label>
            <response_label ident="b"><material><mattext>No answer text provided.</mattext></material></response_label>
            <response_label ident="c"><material><mattext>No answer text provided.</mattext></material></response_label>
          </render_choice></response_lid>
        </presentation>
      </item></section></assessment></questestinterop>`;

    const parsed = (service as any).parseCanvasQti(
      {name: 'lab/assessment_qti.xml', data: qti, mimeType: 'text/xml'},
      []
    );

    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].question.textQuestion.paragraph).toBeTrue();
    expect(parsed.items[0].question.choiceQuestion).toBeUndefined();
    expect(parsed.items[0].question.grading).toBeUndefined();
    expect(parsed.warnings[0]).toContain('duplicate placeholder answers');
  });

  it('numbers repeated choice labels while preserving the correct answer', () => {
    const qti = `<?xml version="1.0"?>
      <questestinterop><assessment><section><item title="Repeated labels">
        <itemmetadata><qtimetadata><qtimetadatafield>
          <fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry>
        </qtimetadatafield></qtimetadata></itemmetadata>
        <presentation>
          <material><mattext>Choose one.</mattext></material>
          <response_lid ident="response1"><render_choice>
            <response_label ident="a"><material><mattext>Same</mattext></material></response_label>
            <response_label ident="b"><material><mattext>Same</mattext></material></response_label>
            <response_label ident="c"><material><mattext>Different</mattext></material></response_label>
          </render_choice></response_lid>
        </presentation>
        <resprocessing><respcondition><conditionvar><varequal respident="response1">b</varequal></conditionvar><setvar>100</setvar></respcondition></resprocessing>
      </item></section></assessment></questestinterop>`;

    const parsed = (service as any).parseCanvasQti(
      {name: 'quiz/assessment_qti.xml', data: qti, mimeType: 'text/xml'},
      []
    );
    const question = parsed.items[0].question;

    expect(question.choiceQuestion.options.map((option: any) => option.value)).toEqual([
      'Same (Choice 1)',
      'Same (Choice 2)',
      'Different'
    ]);
    expect(question.grading.correctAnswers.answers[0].value).toBe('Same (Choice 2)');
  });

});
