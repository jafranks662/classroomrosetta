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

  it('finds dropdown responses nested inside Canvas presentation containers', () => {
    const qti = `<?xml version="1.0"?>
      <questestinterop>
        <assessment title="Nested dropdown quiz">
          <section>
            <item ident="item1" title="Nested dropdowns">
              <itemmetadata><qtimetadata>
                <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_dropdowns_question</fieldentry></qtimetadatafield>
                <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>4</fieldentry></qtimetadatafield>
              </qtimetadata></itemmetadata>
              <presentation>
                <material><mattext texttype="text/html">&lt;p&gt;Complete [CLOZE_01] and [CLOZE_02].&lt;/p&gt;</mattext></material>
                <flow>
                  <response_lid ident="response_CLOZE_01"><material><mattext>CLOZE_01</mattext></material><render_choice>
                    <response_label ident="a"><material><mattext>Asexual</mattext></material></response_label>
                    <response_label ident="b"><material><mattext>Sexual</mattext></material></response_label>
                  </render_choice></response_lid>
                  <response_lid ident="response_CLOZE_02"><material><mattext>CLOZE_02</mattext></material><render_choice>
                    <response_label ident="c"><material><mattext>Mitosis</mattext></material></response_label>
                    <response_label ident="d"><material><mattext>Meiosis</mattext></material></response_label>
                  </render_choice></response_lid>
                </flow>
              </presentation>
              <resprocessing>
                <respcondition><conditionvar><varequal respident="response_CLOZE_01">b</varequal></conditionvar><setvar>100</setvar></respcondition>
                <respcondition><conditionvar><varequal respident="response_CLOZE_02">d</varequal></conditionvar><setvar>100</setvar></respcondition>
              </resprocessing>
            </item>
          </section>
        </assessment>
      </questestinterop>`;

    const parsed = (service as any).parseCanvasQti(
      {name: 'quiz/assessment_qti.xml', data: qti, mimeType: 'text/xml'},
      []
    );

    expect(parsed.items.length).toBe(2);
    expect(parsed.items[0].question.choiceQuestion.type).toBe('DROP_DOWN');
    expect(parsed.items[0].question.grading.pointValue).toBe(1);
    expect(parsed.items[1].question.grading.pointValue).toBe(1);
    expect(parsed.items[0].question.grading.correctAnswers.answers[0].value).toBe('Sexual');
    expect(parsed.items[1].question.grading.correctAnswers.answers[0].value).toBe('Meiosis');
  });

  it('versions the QTI Form cache key so parser fixes regenerate Forms', () => {
    expect((service as any).getFormCacheKey('assignment-123')).toBe('qti-forms-v7|assignment-123');
  });

  it('uses the richer same-title QTI file when the selected resource is incomplete', () => {
    const shortQti = `<?xml version="1.0"?>
      <questestinterop><assessment title="8.2 Practice - Complete Dominance"><section>
        <item title="Short item">
          <itemmetadata><qtimetadata><qtimetadatafield>
            <fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry>
          </qtimetadatafield></qtimetadata></itemmetadata>
          <presentation><material><mattext>Short prompt.</mattext></material>
            <response_lid ident="response1"><render_choice>
              <response_label ident="a"><material><mattext>A</mattext></material></response_label>
              <response_label ident="b"><material><mattext>B</mattext></material></response_label>
            </render_choice></response_lid>
          </presentation>
        </item>
      </section></assessment></questestinterop>`;
    const richQti = `<?xml version="1.0"?>
      <questestinterop><assessment title="8.2 Practice - Complete Dominance"><section>
        <item title="Dropdown item">
          <itemmetadata><qtimetadata><qtimetadatafield>
            <fieldlabel>question_type</fieldlabel><fieldentry>multiple_dropdowns_question</fieldentry>
          </qtimetadatafield></qtimetadata></itemmetadata>
          <presentation><material><mattext>Complete [CLOZE_01] and [CLOZE_02].</mattext></material>
            <response_lid ident="response_CLOZE_01"><material><mattext>CLOZE_01</mattext></material><render_choice>
              <response_label ident="a"><material><mattext>AA</mattext></material></response_label>
              <response_label ident="b"><material><mattext>Aa</mattext></material></response_label>
            </render_choice></response_lid>
            <response_lid ident="response_CLOZE_02"><material><mattext>CLOZE_02</mattext></material><render_choice>
              <response_label ident="c"><material><mattext>aa</mattext></material></response_label>
              <response_label ident="d"><material><mattext>BB</mattext></material></response_label>
            </render_choice></response_lid>
          </presentation>
        </item>
      </section></assessment></questestinterop>`;
    const selected = {name: 'short/assessment_qti.xml', data: shortQti, mimeType: 'text/xml'};
    const richer = {name: 'rich/assessment_qti.xml', data: richQti, mimeType: 'text/xml'};

    const candidate = (service as any).selectBestQtiCandidate(selected, [selected, richer], '8.2 Practice - Complete Dominance');

    expect(candidate.file).toBe(richer);
    expect(candidate.stats.questionCount).toBe(2);
    expect(candidate.stats.dropdownCount).toBe(2);
  });

  it('uses a related quiz bank when Canvas exports only sourcebank references', () => {
    const bankOnlyQti = `<?xml version="1.0"?>
      <questestinterop><assessment title="1.1 Practice - Characteristics of Life"><section>
        <section title="Group 1"><selection_ordering><selection>
          <sourcebank_ref>bank-ref-1</sourcebank_ref>
          <selection_number>1</selection_number>
        </selection></selection_ordering></section>
        <section title="Group 2"><selection_ordering><selection>
          <sourcebank_ref>bank-ref-2</sourcebank_ref>
          <selection_number>1</selection_number>
        </selection></selection_ordering></section>
      </section></assessment></questestinterop>`;
    const relatedBankQti = `<?xml version="1.0"?>
      <questestinterop><assessment title="1A1 Quiz Bank - Characteristics of Life"><section>
        <section title="cells"><selection_ordering><selection><selection_number>1</selection_number></selection></selection_ordering>
          <item title="First cell question">
            <itemmetadata><qtimetadata><qtimetadatafield>
              <fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry>
            </qtimetadatafield></qtimetadata></itemmetadata>
            <presentation><material><mattext>First cell prompt.</mattext></material>
              <response_lid ident="response1"><render_choice>
                <response_label ident="a"><material><mattext>Cell</mattext></material></response_label>
                <response_label ident="b"><material><mattext>Atom</mattext></material></response_label>
              </render_choice></response_lid>
            </presentation>
          </item>
          <item title="Alternate cell question">
            <presentation><material><mattext>Alternate cell prompt.</mattext></material></presentation>
          </item>
        </section>
        <section title="energy"><selection_ordering><selection><selection_number>1</selection_number></selection></selection_ordering>
          <item title="First energy question">
            <itemmetadata><qtimetadata><qtimetadatafield>
              <fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry>
            </qtimetadatafield></qtimetadata></itemmetadata>
            <presentation><material><mattext>First energy prompt.</mattext></material>
              <response_lid ident="response1"><render_choice>
                <response_label ident="a"><material><mattext>Food</mattext></material></response_label>
                <response_label ident="b"><material><mattext>Rock</mattext></material></response_label>
              </render_choice></response_lid>
            </presentation>
          </item>
        </section>
      </section></assessment></questestinterop>`;
    const selected = {name: 'practice/assessment_qti.xml', data: bankOnlyQti, mimeType: 'text/xml'};
    const related = {name: 'bank/assessment_qti.xml', data: relatedBankQti, mimeType: 'text/xml'};

    const candidate = (service as any).selectBestQtiCandidate(selected, [selected, related], '1.1 Practice - Characteristics of Life');

    expect(candidate.file).toBe(related);
    expect(candidate.stats.questionCount).toBe(2);
    expect(candidate.parsedQuiz.items.map((item: any) => item.title)).toEqual([
      'First cell prompt.',
      'First energy prompt.'
    ]);
    expect(candidate.parsedQuiz.warnings[0]).toContain('random question-bank group');
  });

  it('throws a clear error when sourcebank references cannot be resolved', () => {
    const bankOnlyQti = `<?xml version="1.0"?>
      <questestinterop><assessment title="Mystery Practice"><section>
        <section title="Group"><selection_ordering><selection>
          <sourcebank_ref>missing-bank-ref</sourcebank_ref>
          <selection_number>1</selection_number>
        </selection></selection_ordering></section>
      </section></assessment></questestinterop>`;
    const selected = {name: 'practice/assessment_qti.xml', data: bankOnlyQti, mimeType: 'text/xml'};

    expect(() => (service as any).selectBestQtiCandidate(selected, [selected], 'Mystery Practice'))
      .toThrowError(/question-bank reference/);
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

  it('resolves private Canvas image URLs from the exported image filename', () => {
    const qti = `<?xml version="1.0"?>
      <questestinterop><assessment><section><item>
        <itemmetadata><qtimetadata><qtimetadatafield>
          <fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry>
        </qtimetadatafield></qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Compare the methods.&lt;/p&gt;&lt;img src="https://canvas.instructure.com/assessment_questions/384672544/files/312938842/download?verifier=secret" alt="Q221_N6DV1Q_file_0.png"&gt;</mattext></material>
          <response_lid ident="response1"><render_choice>
            <response_label ident="a"><material><mattext>Asexual</mattext></material></response_label>
            <response_label ident="b"><material><mattext>Sexual</mattext></material></response_label>
          </render_choice></response_lid>
        </presentation>
      </item></section></assessment></questestinterop>`;
    const image = {
      name: 'assessment_questions/Q221_N6DV1Q_file_0.png',
      data: new ArrayBuffer(1),
      mimeType: 'image/png'
    };

    const parsed = (service as any).parseCanvasQti(
      {name: 'quiz/assessment_qti.xml', data: qti, mimeType: 'text/xml'},
      [image]
    );

    expect(parsed.items[0].image.file).toBe(image);
    expect(parsed.warnings.length).toBe(0);
  });

  it('skips private Canvas images when the export has no local copy', () => {
    const qti = `<?xml version="1.0"?>
      <questestinterop><assessment><section><item>
        <itemmetadata><qtimetadata><qtimetadatafield>
          <fieldlabel>question_type</fieldlabel><fieldentry>essay_question</fieldentry>
        </qtimetadatafield></qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Explain.&lt;/p&gt;&lt;img src="https://canvas.instructure.com/assessment_questions/1/files/2/download?verifier=expired" alt="missing.png"&gt;</mattext></material>
          <response_str ident="response1"/>
        </presentation>
      </item></section></assessment></questestinterop>`;

    const parsed = (service as any).parseCanvasQti(
      {name: 'quiz/assessment_qti.xml', data: qti, mimeType: 'text/xml'},
      []
    );

    expect(parsed.items[0].image).toBeUndefined();
    expect(parsed.warnings[0]).toContain('Skipped inaccessible Canvas image');
  });

  it('does not pass unresolved private Canvas image URLs to Google Forms', () => {
    const formItem = (service as any).toFormItem({
      kind: 'question',
      title: 'Private image',
      image: {
        source: 'https://canvas.instructure.com/assessment_questions/384672544/files/312938842/download?verifier=expired',
        altText: 'Q221_N6DV1Q_file_0.png'
      },
      question: {
        required: true,
        textQuestion: {paragraph: true}
      }
    }, new Map());

    expect(formItem.questionItem.image).toBeUndefined();
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

  it('keeps long lab prompts out of the Forms item title', () => {
    const longPrompt = `Use the Osmosis simulation at the following link. ${'Record your observations. '.repeat(45)}`;
    const qti = `<?xml version="1.0"?>
      <questestinterop><assessment><section><item title="Question">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
          <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>1</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;${longPrompt}&lt;/p&gt;</mattext></material>
          <response_lid ident="response1"><render_choice>
            <response_label ident="a"><material><mattext>No answer text provided.</mattext></material></response_label>
            <response_label ident="b"><material><mattext>No answer text provided.</mattext></material></response_label>
          </render_choice></response_lid>
        </presentation>
      </item></section></assessment></questestinterop>`;

    const parsed = (service as any).parseCanvasQti(
      {name: 'lab/assessment_qti.xml', data: qti, mimeType: 'text/xml'},
      []
    );

    expect(parsed.items[0].title.length).toBeLessThanOrEqual(120);
    expect(parsed.items[0].description.length).toBeGreaterThan(parsed.items[0].title.length);
    expect(parsed.items[0].question.textQuestion.paragraph).toBeTrue();
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
