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
        expect(items[0].qtiFile?.[0].name).toBe('quiz/quiz.xml');
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
