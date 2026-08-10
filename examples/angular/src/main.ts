import { provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideImageAware } from '@image-aware/angular';
import { AppComponent } from './app.component';

void bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    // Registers <image-surface>. Equivalent to `import '@image-aware/element/auto'`.
    provideImageAware(),
  ],
});
