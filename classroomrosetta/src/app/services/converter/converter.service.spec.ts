import {TestBed} from '@angular/core/testing';
import {toArray} from 'rxjs';
import {ConverterService} from './converter.service';

describe('ConverterService', () => {
  let service: ConverterService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ConverterService);
  });

  it('recognizes the Canvas imsqti_xmlv1p2 resource type', done => {
    const manifest = `<?xml version="1.0"?>
      <manifest>
        <organizations><organization>
          <item identifier="item1" identifierref="quiz1"><title>Canvas Quiz</title></item>
        </organization></organizations>
        <resources>
          <resource identifier="quiz1" type="imsqti_xmlv1p2" href="quiz/quiz.xml">
            <file href="quiz/quiz.xml"/>
          </resource>
        </resources>
      </manifest>`;
    const qti = `<?xml version="1.0"?><questestinterop><assessment><section/></assessment></questestinterop>`;

    service.convertImscc([
      {name: 'imsmanifest.xml', data: manifest, mimeType: 'text/xml'},
      {name: 'quiz/quiz.xml', data: qti, mimeType: 'text/xml'}
    ]).pipe(toArray()).subscribe({
      next: items => {
        expect(items.length).toBe(1);
        expect(items[0].workType).toBe('ASSIGNMENT');
        expect(items[0].qtiFile?.[0].name).toBe('quiz/quiz.xml');
        done();
      },
      error: done.fail
    });
  });

  it('finds QTI resources when Canvas exports an empty organizations section', done => {
    const manifest = `<?xml version="1.0"?>
      <manifest>
        <organizations/>
        <resources>
          <resource identifier="quiz1" type="imsqti_xmlv1p2">
            <file href="quiz/quiz.xml"/>
            <dependency identifierref="quiz1-meta"/>
          </resource>
          <resource identifier="quiz1-meta" type="associatedcontent/imscc_xmlv1p1/learning-application-resource">
            <file href="quiz/assessment_meta.xml"/>
          </resource>
        </resources>
      </manifest>`;
    const qti = `<?xml version="1.0"?><questestinterop><assessment title="Canvas Quiz"><section/></assessment></questestinterop>`;

    service.convertImscc([
      {name: 'imsmanifest.xml', data: manifest, mimeType: 'text/xml'},
      {name: 'quiz/quiz.xml', data: qti, mimeType: 'text/xml'},
      {name: 'quiz/assessment_meta.xml', data: '<quiz/>', mimeType: 'text/xml'}
    ]).pipe(toArray()).subscribe({
      next: items => {
        expect(items.length).toBe(1);
        expect(items[0].title).toBe('Canvas Quiz');
        expect(items[0].qtiFile?.[0].name).toBe('quiz/quiz.xml');
        done();
      },
      error: done.fail
    });
  });

  it('includes unreferenced Canvas quizzes without duplicating module quizzes', done => {
    const manifest = `<?xml version="1.0"?>
      <manifest>
        <organizations><organization>
          <item identifier="module"><title>Unit 9 - Quiz</title>
            <item identifier="quiz-item" identifierref="quiz1"><title>9.1 Quiz - DNA</title></item>
          </item>
        </organization></organizations>
        <resources>
          <resource identifier="quiz1" type="imsqti_xmlv1p2">
            <file href="quiz1/quiz.xml"/>
            <dependency identifierref="quiz1-meta"/>
          </resource>
          <resource identifier="quiz1-meta" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="quiz1/assessment_meta.xml"/>
          <resource identifier="quiz2" type="imsqti_xmlv1p2">
            <file href="quiz2/quiz.xml"/>
            <dependency identifierref="quiz2-meta"/>
          </resource>
          <resource identifier="quiz2-meta" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="quiz2/assessment_meta.xml"/>
          <resource identifier="quiz-image" type="webcontent" href="quiz2/question.png"/>
        </resources>
      </manifest>`;
    const qti = '<questestinterop><assessment><section/></assessment></questestinterop>';

    service.convertImscc([
      {name: 'imsmanifest.xml', data: manifest, mimeType: 'text/xml'},
      {name: 'quiz1/quiz.xml', data: qti, mimeType: 'text/xml'},
      {name: 'quiz1/assessment_meta.xml', data: '<quiz><title>9.1 Quiz - DNA</title></quiz>', mimeType: 'text/xml'},
      {name: 'quiz2/quiz.xml', data: qti, mimeType: 'text/xml'},
      {name: 'quiz2/assessment_meta.xml', data: '<quiz><title>9.2 Practice - Protein Synthesis</title></quiz>', mimeType: 'text/xml'},
      {name: 'quiz2/question.png', data: 'data:image/png;base64,AA==', mimeType: 'image/png'}
    ]).pipe(toArray()).subscribe({
      next: items => {
        expect(items.length).toBe(2);
        expect(items.filter(item => item.title === '9.1 Quiz - DNA').length).toBe(1);
        const practice = items.find(item => item.title === '9.2 Practice - Protein Synthesis');
        expect(practice?.associatedWithDeveloper?.topic).toBe('Unit 9 - PRACTICES');
        done();
      },
      error: done.fail
    });
  });

  it('includes standalone Canvas quiz banks under a Question Banks topic', done => {
    const manifest = `<?xml version="1.0"?>
      <manifest>
        <organizations><organization>
          <item identifier="module"><title>Term 1 (1st - 3rd 9 Weeks)</title>
            <item identifier="quiz-item" identifierref="quiz1"><title>1.1 Practice - Characteristics of Life</title></item>
          </item>
        </organization></organizations>
        <resources>
          <resource identifier="quiz1" type="imsqti_xmlv1p2">
            <file href="quiz1/quiz.xml"/>
            <dependency identifierref="quiz1-meta"/>
          </resource>
          <resource identifier="quiz1-meta" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="quiz1/assessment_meta.xml"/>
          <resource identifier="bank1" type="imsqti_xmlv1p2">
            <file href="bank1/bank.xml"/>
            <dependency identifierref="bank1-meta"/>
          </resource>
          <resource identifier="bank1-meta" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="bank1/assessment_meta.xml"/>
        </resources>
      </manifest>`;
    const qti = '<questestinterop><assessment><section/></assessment></questestinterop>';

    service.convertImscc([
      {name: 'imsmanifest.xml', data: manifest, mimeType: 'text/xml'},
      {name: 'quiz1/quiz.xml', data: qti, mimeType: 'text/xml'},
      {name: 'quiz1/assessment_meta.xml', data: '<quiz><title>1.1 Practice - Characteristics of Life</title></quiz>', mimeType: 'text/xml'},
      {name: 'bank1/bank.xml', data: qti, mimeType: 'text/xml'},
      {name: 'bank1/assessment_meta.xml', data: '<quiz><title>1A1 Quiz Bank - Characteristics of Life</title></quiz>', mimeType: 'text/xml'}
    ]).pipe(toArray()).subscribe({
      next: items => {
        const bank = items.find(item => item.title === '1A1 Quiz Bank - Characteristics of Life');
        expect(bank).toBeTruthy();
        expect(bank?.associatedWithDeveloper?.topic).toBe('Question Banks');
        expect(bank?.qtiFile?.[0].name).toBe('bank1/bank.xml');
        done();
      },
      error: done.fail
    });
  });

  it('does not expose Canvas quiz image resources as standalone coursework', done => {
    const manifest = `<?xml version="1.0"?>
      <manifest>
        <organizations/>
        <resources>
          <resource identifier="quiz1" type="imsqti_xmlv1p2">
            <file href="quiz/quiz.xml"/>
            <dependency identifierref="quiz1-meta"/>
          </resource>
          <resource identifier="quiz1-meta" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="quiz/assessment_meta.xml"/>
          <resource identifier="quiz-image" type="webcontent" href="quiz/question.png"/>
        </resources>
      </manifest>`;

    service.convertImscc([
      {name: 'imsmanifest.xml', data: manifest, mimeType: 'text/xml'},
      {name: 'quiz/quiz.xml', data: '<questestinterop><assessment><section/></assessment></questestinterop>', mimeType: 'text/xml'},
      {name: 'quiz/assessment_meta.xml', data: '<quiz><title>9.1 Quiz - DNA</title></quiz>', mimeType: 'text/xml'},
      {name: 'quiz/question.png', data: 'data:image/png;base64,AA==', mimeType: 'image/png'}
    ]).pipe(toArray()).subscribe({
      next: items => {
        expect(items.length).toBe(1);
        expect(items[0].title).toBe('9.1 Quiz - DNA');
        done();
      },
      error: done.fail
    });
  });

  it('converts standalone Canvas HTML pages to Classroom materials', done => {
    const manifest = `<?xml version="1.0"?>
      <manifest>
        <organizations><organization>
          <item identifier="item1" identifierref="page1"><title>Course Page</title></item>
        </organization></organizations>
        <resources>
          <resource identifier="page1" type="webcontent" href="pages/course-page.html">
            <file href="pages/course-page.html"/>
          </resource>
        </resources>
      </manifest>`;

    service.convertImscc([
      {name: 'imsmanifest.xml', data: manifest, mimeType: 'text/xml'},
      {name: 'pages/course-page.html', data: '<p>Read this page.</p>', mimeType: 'text/html'}
    ]).pipe(toArray()).subscribe({
      next: items => {
        expect(items.length).toBe(1);
        expect(items[0].workType).toBe('MATERIAL');
        done();
      },
      error: done.fail
    });
  });

  it('groups quiz-titled items from term modules into term quiz topics', done => {
    const manifest = `<?xml version="1.0"?>
      <manifest>
        <organizations><organization>
          <item identifier="term1"><title>Term 1 (1st - 3rd 9 Weeks)</title>
            <item identifier="quiz-item" identifierref="quiz1"><title>2.5 Quiz - Enzymes</title></item>
            <item identifier="notes-item" identifierref="page1"><title>2.5 Notes - Enzymes</title></item>
          </item>
        </organization></organizations>
        <resources>
          <resource identifier="quiz1" type="imsqti_xmlv1p2" href="quiz/quiz.xml">
            <file href="quiz/quiz.xml"/>
          </resource>
          <resource identifier="page1" type="webcontent" href="pages/notes.html">
            <file href="pages/notes.html"/>
          </resource>
        </resources>
      </manifest>`;

    service.convertImscc([
      {name: 'imsmanifest.xml', data: manifest, mimeType: 'text/xml'},
      {name: 'quiz/quiz.xml', data: '<questestinterop><assessment><section/></assessment></questestinterop>', mimeType: 'text/xml'},
      {name: 'pages/notes.html', data: '<p>Notes</p>', mimeType: 'text/html'}
    ]).pipe(toArray()).subscribe({
      next: items => {
        expect(items.find(item => item.title?.includes('Quiz'))?.associatedWithDeveloper?.topic).toBe('T1 - QUIZZES');
        expect(items.find(item => item.title?.includes('Notes'))?.associatedWithDeveloper?.topic).toBe('Term 1 (1st - 3rd 9 Weeks)');
        done();
      },
      error: done.fail
    });
  });
});
