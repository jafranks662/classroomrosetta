/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

if (window.location.hostname === 'canvas-classroom-converter.web.app') {
  const canonicalUrl = new URL(window.location.href);
  canonicalUrl.hostname = 'canvas-classroom-converter.firebaseapp.com';
  window.location.replace(canonicalUrl.toString());
} else {
  bootstrapApplication(AppComponent, appConfig)
    .catch((err) => console.error(err));
}
