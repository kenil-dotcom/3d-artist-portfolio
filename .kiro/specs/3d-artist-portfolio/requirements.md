# Requirements Document

## Introduction

This document defines the requirements for a portfolio website that showcases the work of a 3D artist. The site presents 3D renders, models, and animations through curated project galleries, provides background information about the artist, and enables potential clients to submit commission inquiries. The site is content-driven with a strong emphasis on visual presentation, fast media delivery, and accessibility across devices.

## Glossary

- **Portfolio_Site**: The complete website system being specified.
- **Artist**: The 3D artist who owns the portfolio and authors all displayed work.
- **Visitor**: Any unauthenticated person browsing the public portfolio.
- **Admin**: The Artist (or delegate) authenticated with content-management privileges.
- **Project**: A curated collection of related media items representing a single body of 3D work, with descriptive metadata.
- **Media_Item**: A single piece of content within a Project, such as a still render image, a 3D model preview, or a video animation.
- **Gallery**: The browsable index of Projects, presented as a grid or list with filtering and sorting controls.
- **Project_Detail_Page**: The full view of a single Project, displaying all of its Media_Items and metadata.
- **Bio_Page**: The page describing the Artist, including biography, skills, software used, and CV/resume.
- **Contact_Form**: The form Visitors use to submit general contact messages.
- **Commission_Inquiry_Form**: The form Visitors use to request paid 3D work, including project type, budget range, and deadline fields.
- **Inquiry**: A submitted Contact_Form or Commission_Inquiry_Form record.
- **CMS**: The Content Management System used by the Admin to create, edit, and delete Projects and Media_Items.
- **Tag**: A short label attached to a Project for filtering (e.g., "character", "environment", "animation").
- **Category**: A top-level classification of a Project (e.g., "Renders", "Models", "Animations").

## Requirements

### Requirement 1: Public Landing Page

**User Story:** As a Visitor, I want a landing page that introduces the Artist and highlights featured work, so that I can quickly understand who the Artist is and what kind of 3D work they produce.

#### Acceptance Criteria

1. WHEN a Visitor navigates to the site root URL over a 10 Mbps connection with up to 50 ms latency, THE Portfolio_Site SHALL render the landing page's primary content (Artist name, tagline, navigation links, and featured Projects section with thumbnails) within 2 seconds of the initial request.
2. THE Portfolio_Site SHALL display the Artist's name (1 to 100 characters) and a single-sentence tagline (1 to 160 characters, no line breaks) on the landing page.
3. THE Portfolio_Site SHALL display between 3 and 8 featured Projects on the landing page as selected by the Admin, with each featured Project presenting at minimum a thumbnail image, the Project title, and an activatable link to its Project_Detail_Page.
4. WHEN a Visitor activates a featured Project via mouse click, touch tap, or keyboard Enter/Space key on the focused element, THE Portfolio_Site SHALL navigate to the corresponding Project_Detail_Page within 2 seconds.
5. THE Portfolio_Site SHALL provide visible, keyboard-focusable navigation links to the Gallery, Bio_Page, and Contact_Form from the landing page, with each link reachable via Tab key traversal.
6. IF no featured Projects have been configured by the Admin and at least 6 published Projects exist, THEN THE Portfolio_Site SHALL display the 6 most recently published Projects on the landing page, ordered by publication date in descending order.
7. IF no featured Projects have been configured by the Admin and fewer than 6 published Projects exist, THEN THE Portfolio_Site SHALL display all available published Projects (between 1 and 5) on the landing page, ordered by publication date in descending order.
8. IF no featured Projects have been configured and no published Projects exist, THEN THE Portfolio_Site SHALL display a placeholder message in place of the featured Projects section indicating that featured work is not yet available, while still rendering the Artist name, tagline, and navigation links.

### Requirement 2: Project Gallery

**User Story:** As a Visitor, I want to browse all of the Artist's Projects in a single gallery, so that I can explore the full body of work and find Projects that interest me.

#### Acceptance Criteria

1. WHEN a Visitor navigates to the Gallery, THE Portfolio_Site SHALL display all published Projects as a paginated grid of thumbnails ordered by newest first by default, with the first page rendered within 3 seconds under normal network conditions.
2. THE Portfolio_Site SHALL display each thumbnail with the Project title truncated to a maximum of 80 characters, the primary Category name, and the cover image; if the Project has no cover image assigned, THE Portfolio_Site SHALL display a placeholder image in place of the cover image.
3. WHEN a Visitor selects a Category filter, THE Portfolio_Site SHALL display only Projects assigned to the selected Category, combined conjunctively with any active Tag filters and the active sort option, and SHALL reset the Gallery to page 1.
4. WHEN a Visitor selects between 1 and 10 Tag filters, THE Portfolio_Site SHALL display only Projects that include all selected Tags, combined conjunctively with any active Category filter and the active sort option, and SHALL reset the Gallery to page 1.
5. WHEN a Visitor selects a sort option, THE Portfolio_Site SHALL order Projects by the selected criterion (newest, oldest, or title A-Z ascending) and re-render the visible Gallery page within 2 seconds.
6. THE Portfolio_Site SHALL display at most 24 Projects per Gallery page.
7. WHEN a Visitor activates a Project thumbnail via mouse click, touch tap, or keyboard Enter or Space key while the thumbnail is focused, THE Portfolio_Site SHALL navigate to the corresponding Project_Detail_Page.
8. IF no Projects match the active filters, THEN THE Portfolio_Site SHALL display a message indicating that no Projects were found and SHALL display a control that, when activated, removes all Category and Tag filters and returns the Gallery to the default unfiltered view on page 1.
9. WHEN the total number of matching Projects exceeds 24, THE Portfolio_Site SHALL display pagination controls that allow the Visitor to navigate to the next page, the previous page, the first page, the last page, or any specific page number within the valid range, and SHALL indicate the current page and the total number of pages at all times.
10. IF a requested Gallery page number is outside the valid range of 1 to the total number of pages, THEN THE Portfolio_Site SHALL display the first page of results and SHALL display a message indicating that the requested page was unavailable.

### Requirement 3: Project Detail Page

**User Story:** As a Visitor, I want to view a detail page for each Project, so that I can see all related Media_Items and read about the Project.

#### Acceptance Criteria

1. WHEN a Visitor navigates to a Project_Detail_Page for a published Project, THE Portfolio_Site SHALL display the Project title, description, Category, Tags, creation date, and software used within 3 seconds, rendering an empty placeholder for any field that has no value rather than omitting the field label.
2. WHEN a Visitor navigates to a Project_Detail_Page, THE Portfolio_Site SHALL display all Media_Items associated with the Project in the ascending order configured by the Admin, and SHALL display a "No media available" message if the Project has zero associated Media_Items.
3. WHEN a Visitor activates a still image Media_Item, THE Portfolio_Site SHALL display the image in a full-screen lightbox view that overlays the page and prevents scrolling of the underlying content.
4. WHILE the lightbox is open, THE Portfolio_Site SHALL provide visible, keyboard-accessible controls to navigate to the previous Media_Item, navigate to the next Media_Item, close the lightbox, and toggle viewing the image at its original uploaded pixel dimensions at 100% scale.
5. WHILE the lightbox is open AND the currently displayed Media_Item is the first in the ordered list, THE Portfolio_Site SHALL disable the "previous" control, and WHILE the currently displayed Media_Item is the last in the ordered list, THE Portfolio_Site SHALL disable the "next" control.
6. WHEN a Visitor activates a video Media_Item, THE Portfolio_Site SHALL play the video with visible controls for play, pause, seek, mute, volume adjustment between 0% and 100%, and full screen toggle.
7. WHERE a Media_Item is a 3D model preview, THE Portfolio_Site SHALL render an interactive viewer that supports orbit rotation around all axes, panning along the horizontal and vertical axes, and zoom between a minimum and maximum bound that keeps the model fully visible.
8. THE Portfolio_Site SHALL display a "Back to Gallery" navigation control on every Project_Detail_Page, and WHEN the Visitor activates this control, THE Portfolio_Site SHALL navigate to the Gallery within 3 seconds.
9. THE Portfolio_Site SHALL display "previous Project" and "next Project" navigation controls on every Project_Detail_Page, ordered by publication date descending, and SHALL disable the "previous Project" control on the most recently published Project and the "next Project" control on the oldest published Project.
10. IF a Project_Detail_Page is requested for an identifier that does not exist or refers to an unpublished Project, THEN THE Portfolio_Site SHALL return an HTTP 404 response and render a "Project not found" page that includes a navigation control back to the Gallery, without exposing whether the identifier exists but is unpublished.

### Requirement 4: Media Optimization and Delivery

**User Story:** As a Visitor, I want media to load quickly and at appropriate quality for my device, so that I can view the Artist's work without delays or wasted bandwidth.

#### Acceptance Criteria

1. THE Portfolio_Site SHALL serve at least three responsive image variants per Media_Item, with widths covering mobile (up to 480 pixels), tablet (481 to 1024 pixels), and desktop (1025 pixels and above) viewports, selecting the smallest variant whose width is greater than or equal to the requesting viewport width.
2. WHEN a client request indicates support for WebP or AVIF, THE Portfolio_Site SHALL serve the Media_Item in AVIF if supported, otherwise WebP if supported.
3. IF a client request does not indicate support for WebP or AVIF, THEN THE Portfolio_Site SHALL serve the Media_Item in its original JPEG or PNG format.
4. THE Portfolio_Site SHALL defer loading of images and videos whose top edge is more than 200 pixels below the bottom edge of the initial viewport, and SHALL begin loading each such Media_Item once it enters within 200 pixels of the viewport.
5. WHILE a Visitor loads a Project_Detail_Page over a connection with measured downlink of at least 10 Mbps, THE Portfolio_Site SHALL render the first Media_Item within 3 seconds of navigation start.
6. THE Portfolio_Site SHALL display a placeholder (a low-resolution preview no larger than 32 pixels in its longest dimension, or a solid color sampled from the Media_Item) within 500 milliseconds of the Media_Item element entering the viewport, and SHALL keep the placeholder visible until the full-resolution Media_Item has finished loading.
7. IF a Media_Item does not finish loading within 15 seconds of its load request, or if the request returns a transport or server error, THEN THE Portfolio_Site SHALL replace the placeholder with an error indicator and a retry control, preserve the page layout without shifting surrounding content, and allow the Visitor to trigger up to 3 manual retry attempts per Media_Item.

### Requirement 5: Artist Bio Page

**User Story:** As a Visitor, I want to read about the Artist's background and skills, so that I can decide whether the Artist is a good fit for my needs.

#### Acceptance Criteria

1. WHEN a Visitor navigates to the Bio_Page, THE Portfolio_Site SHALL display the Artist's biography text (up to 5,000 characters), a profile image, and a list of skills (between 1 and 30 entries) within 3 seconds of page load.
2. WHEN a Visitor navigates to the Bio_Page, THE Portfolio_Site SHALL display a list of software tools (between 0 and 30 entries) the Artist uses, with each entry showing the tool name as text.
3. WHERE a downloadable CV or resume has been uploaded by the Admin, THE Portfolio_Site SHALL display a download link on the Bio_Page that initiates a file download when activated by the Visitor.
4. WHERE one or more external profile links (such as ArtStation, Instagram, LinkedIn, or Behance) have been configured by the Admin, THE Portfolio_Site SHALL display each configured link on the Bio_Page and open the target profile in a new browser tab when activated.
5. IF the Artist's biography text, profile image, or skills list has not been configured by the Admin, THEN THE Portfolio_Site SHALL display a placeholder message indicating that the corresponding content is unavailable, without preventing the remaining Bio_Page sections from rendering.
6. IF the Bio_Page content fails to load within 10 seconds, THEN THE Portfolio_Site SHALL display an error message indicating that the bio content could not be retrieved and SHALL provide a retry control to the Visitor.

### Requirement 6: Contact Form

**User Story:** As a Visitor, I want to send a general message to the Artist, so that I can ask questions or start a conversation.

#### Acceptance Criteria

1. THE Portfolio_Site SHALL display a Contact_Form with the following required fields: name (1 to 100 characters), email address (RFC 5322 conformant, 1 to 254 characters), subject (1 to 200 characters), and message (10 to 5,000 characters).
2. WHEN a Visitor submits the Contact_Form with all required fields populated and an email address that conforms to RFC 5322, THE Portfolio_Site SHALL persist the Inquiry and send a notification email to the Artist within 60 seconds of submission.
3. WHEN the Contact_Form is submitted successfully, THE Portfolio_Site SHALL display a confirmation message to the Visitor within 2 seconds of successful persistence.
4. IF the Contact_Form is submitted with one or more required fields empty, an email address that does not conform to RFC 5322, or any field outside its specified length range, THEN THE Portfolio_Site SHALL reject the submission, retain all entered field values, display an inline error message identifying each invalid field and the validation rule it violated, and SHALL NOT persist the Inquiry or send a notification email.
5. THE Portfolio_Site SHALL apply CAPTCHA or honeypot spam protection to every Contact_Form submission.
6. IF the Portfolio_Site detects that a Contact_Form submission is spam, THEN THE Portfolio_Site SHALL reject the submission without persisting the Inquiry, without sending a notification email, and SHALL display a generic error message to the Visitor.
7. THE Portfolio_Site SHALL rate-limit Contact_Form submissions to at most 5 successful submissions per source IP address within any rolling 60-minute window, and IF a submission would exceed this limit, THEN THE Portfolio_Site SHALL reject the submission without persisting the Inquiry and display a rate-limit error message indicating when the Visitor may try again.
8. IF the notification email to the Artist fails to send within 60 seconds of a successful Contact_Form submission, THEN THE Portfolio_Site SHALL retain the persisted Inquiry, retry email delivery up to 3 times within 5 minutes, and surface a delivery failure indication to the Admin if all retries fail.

### Requirement 7: Commission Inquiry Form

**User Story:** As a Visitor, I want to request a commissioned piece from the Artist, so that I can hire the Artist for paid work.

#### Acceptance Criteria

1. THE Portfolio_Site SHALL display a Commission_Inquiry_Form with the following fields: name (required, 1 to 100 characters), email address (required, syntactically valid per RFC 5322, 1 to 254 characters), project type (required, single selection), budget range (required, single selection), target deadline (required, calendar date on or after the submission date), and project description (required, 20 to 5000 characters).
2. THE Portfolio_Site SHALL provide a project type selector with exactly the options "Character", "Environment", "Product Visualization", "Animation", and "Other", where "Other" is selectable without additional input.
3. THE Portfolio_Site SHALL provide a budget range selector populated with between 1 and 10 discrete options configured by the Admin, displayed in the order configured by the Admin.
4. WHEN a Visitor submits the Commission_Inquiry_Form with all required fields populated and a syntactically valid email address, THE Portfolio_Site SHALL persist the Inquiry with a commission inquiry tag, send a notification email to the Artist within 60 seconds, and display a confirmation message to the Visitor indicating the Inquiry was received.
5. IF a Visitor submits the Commission_Inquiry_Form with one or more required fields empty, an email address that is not syntactically valid, a target deadline earlier than the submission date, or a project description outside the 20 to 5000 character range, THEN THE Portfolio_Site SHALL reject the submission, retain all entered field values, and display an error message identifying each invalid field and the validation rule it violated.
6. WHERE reference image upload is enabled, THE Portfolio_Site SHALL allow Visitors to attach up to 5 image files of up to 10 MB each, with a combined total of up to 50 MB per submission, in JPEG, PNG, or WebP format to a Commission_Inquiry_Form submission.
7. IF an attached file exceeds the per-file size limit, exceeds the combined total size limit, or uses a format other than JPEG, PNG, or WebP, THEN THE Portfolio_Site SHALL reject only the offending file, retain all other validly attached files and entered field values, and display an error message identifying the rejected file by its original filename and stating the reason for rejection.
8. THE Portfolio_Site SHALL apply the same spam protection and rate-limiting rules to the Commission_Inquiry_Form as to the Contact_Form.
9. IF the notification email to the Artist cannot be sent within 60 seconds of a successful submission, THEN THE Portfolio_Site SHALL retain the persisted Inquiry, retry delivery, and surface a delivery failure indication to the Admin without altering the confirmation already shown to the Visitor.

### Requirement 8: Content Management

**User Story:** As an Admin, I want to manage Projects, Media_Items, and Bio content through a CMS, so that I can keep the portfolio current without editing code.

#### Acceptance Criteria

1. IF a request is made to any content-management function without a valid authenticated Admin session, THEN THE CMS SHALL reject the request and return an authentication-required error without performing the requested operation.
2. WHEN an Admin submits a new Project, THE CMS SHALL accept a title (1 to 120 characters), a description (0 to 5,000 characters), exactly one Category, 0 to 20 Tags, one cover image, a software-used list (0 to 20 entries, each 1 to 60 characters), a creation date (valid calendar date not later than the current date), and a publication status of either "draft" or "published".
3. WHEN an Admin uploads a Media_Item to a Project, THE CMS SHALL accept image files in JPEG, PNG, or WebP format, video files in MP4 or WebM format, and 3D model files in glTF or GLB format, each up to 100 MB per file.
4. IF an Admin uploads a Media_Item whose format is not in the accepted list in criterion 3 or whose size exceeds 100 MB, THEN THE CMS SHALL reject the upload and display an error indicating the unsupported format or size limit, and SHALL NOT attach the file to the Project.
5. WHEN an Admin reorders Media_Items within a Project, THE CMS SHALL persist the new display order and apply it to the Project_Detail_Page within 60 seconds.
6. WHEN an Admin sets a Project's publication status to "published" or "draft", THE CMS SHALL persist the new status and apply it to the Portfolio_Site within 60 seconds.
7. WHILE a Project's publication status is "draft", THE Portfolio_Site SHALL NOT display the Project in the Gallery, on the landing page, or on any Project_Detail_Page accessible to Visitors, and SHALL return a not-found response for any direct request to that Project's detail URL by a Visitor.
8. WHEN an Admin confirms deletion of a Project, THE CMS SHALL remove the Project record and all Media_Items associated with that Project from the Portfolio_Site within 60 seconds, after which any Visitor request for the Project or its Media_Items shall return a not-found response.
9. WHEN an Admin saves edits to the Bio_Page, THE CMS SHALL accept biography text (0 to 5,000 characters), one profile image, a skills list (0 to 30 entries, each 1 to 60 characters), a software list (0 to 30 entries, each 1 to 60 characters), social links (0 to 15 entries, each a syntactically valid URL up to 2,048 characters), and one CV file in PDF format up to 20 MB.
10. WHEN an Admin designates Projects as featured on the landing page, THE CMS SHALL accept between 0 and 12 featured Projects and apply the change to the landing page within 60 seconds.
11. IF an Admin attempts to publish a Project that is missing a title, missing a cover image, or has zero Media_Items attached, THEN THE CMS SHALL reject the publication, retain the Project in "draft" status, and display a validation error that individually identifies each missing element.

### Requirement 9: Inquiry Management

**User Story:** As an Admin, I want to view and manage submitted Inquiries, so that I can respond to Visitors and track commission requests.

#### Acceptance Criteria

1. WHEN an Admin opens the Inquiries view in the CMS, THE CMS SHALL display all Inquiries ordered by submission date descending (most recent first), paginated at 25 Inquiries per page.
2. WHEN the Inquiries view is rendered, THE CMS SHALL display for each Inquiry the submission date and time, Visitor name (truncated at 100 characters), Visitor email address (truncated at 254 characters), type (one of: general, commission), and status (one of: new, read, archived).
3. WHEN an Admin opens an individual Inquiry, THE CMS SHALL display all submitted fields of that Inquiry, including, for commission Inquiries, every attached reference image rendered as a viewable thumbnail with a link to the full-size image.
4. IF an Inquiry has no attached reference images, THEN THE CMS SHALL display an indicator stating that no reference images were submitted.
5. WHEN an Admin changes an Inquiry's status to read or archived, THE CMS SHALL persist the new status within 2 seconds and update the status shown for that Inquiry in the Inquiries list on the next render without altering any other Inquiry fields.
6. IF persisting an Inquiry status change fails, THEN THE CMS SHALL retain the previous status, leave the Inquiries list unchanged, and display an error message to the Admin indicating that the status update did not succeed.
7. WHEN an Admin applies a filter by type (general, commission, or all) or by status (new, read, archived, or all), THE CMS SHALL display only Inquiries matching all selected filter values, preserving the submission-date-descending order, and SHALL display an empty-state message when no Inquiries match.
8. WHILE an Admin is not authenticated in the CMS, THE CMS SHALL deny access to the Inquiries view and to any individual Inquiry.

### Requirement 10: Responsive and Accessible Design

**User Story:** As a Visitor, I want the site to work on any device and to be usable with assistive technology, so that I can browse the Artist's work regardless of how I access the web.

#### Acceptance Criteria

1. WHEN a Visitor loads any page on a viewport with a width between 320 and 2560 pixels, THE Portfolio_Site SHALL render all content without horizontal scrolling and without overlapping or clipped interactive controls.
2. THE Portfolio_Site SHALL meet WCAG 2.1 Level AA conformance, including a minimum text contrast ratio of 4.5:1 for normal text and 3:1 for large text (18pt or 14pt bold and larger), keyboard operability of all interactive controls, and use of semantic landmarks for header, navigation, main, and footer regions.
3. THE Portfolio_Site SHALL provide descriptive alternative text for every non-decorative image rendered to Visitors, and SHALL mark decorative images so that assistive technologies skip them.
4. IF an image rendered to a Visitor has no alternative text supplied and is not marked as decorative, THEN THE Portfolio_Site SHALL prevent that image from being published and SHALL surface a validation error to the Admin indicating the missing alternative text.
5. WHEN a Visitor navigates the Portfolio_Site using a keyboard alone, THE Portfolio_Site SHALL expose every interactive control in a tab order that matches the visual reading order, SHALL display a focus indicator with a minimum contrast ratio of 3:1 against its adjacent background, and SHALL provide a skip-to-main-content link as the first focusable element on each page.
6. WHEN a Visitor activates the lightbox or 3D model viewer with a keyboard, THE Portfolio_Site SHALL allow the Escape key to close the viewer, SHALL allow the Left and Right arrow keys to navigate to the previous and next item where applicable, SHALL expose a visible close control reachable by Tab, and SHALL return keyboard focus to the originating element within 200 milliseconds of close.
7. WHILE the lightbox or 3D model viewer is open, THE Portfolio_Site SHALL trap keyboard focus within the viewer so that Tab and Shift+Tab cycle only through controls inside the viewer.
8. WHERE the Admin has supplied captions or a transcript for a video Media_Item that contains spoken dialogue, THE Portfolio_Site SHALL make those captions or transcripts available to Visitors through a control reachable by both pointer and keyboard.

### Requirement 11: SEO and Sharing

**User Story:** As the Artist, I want the site to be discoverable through search engines and previewable on social media, so that I can attract new Visitors and clients.

#### Acceptance Criteria

1. THE Portfolio_Site SHALL render an HTML title between 10 and 60 characters and a meta description between 50 and 160 characters for the landing page, the Gallery, the Bio_Page, and every Project_Detail_Page, where the title and description values for each page differ from those of every other page on the Portfolio_Site.
2. THE Portfolio_Site SHALL include Open Graph metadata (og:title, og:description, og:image, og:url, og:type) and Twitter Card metadata (twitter:card, twitter:title, twitter:description, twitter:image) on every public page, where og:title and twitter:title are between 10 and 60 characters and og:description and twitter:description are between 50 and 160 characters.
3. THE Portfolio_Site SHALL provide a preview image referenced by og:image and twitter:image with a minimum size of 1200 by 630 pixels and a maximum file size of 5 megabytes for every public page.
4. THE Portfolio_Site SHALL serve a sitemap.xml at the site root that lists every published public URL and excludes URLs of unpublished Projects and CMS routes.
5. THE Portfolio_Site SHALL serve a robots.txt at the site root that allows indexing of all public URLs listed in sitemap.xml and disallows indexing of all CMS routes.
6. WHEN a Project is published or unpublished, THE Portfolio_Site SHALL update sitemap.xml to reflect the new published URL set within 5 minutes of the publish or unpublish action completing.
7. IF the sitemap.xml update fails to complete within 5 minutes after a Project is published or unpublished, THEN THE Portfolio_Site SHALL retain the previous valid sitemap.xml and surface an error indication to the Artist in the CMS.

### Requirement 12: Privacy and Data Protection

**User Story:** As a Visitor, I want my personal data to be handled responsibly, so that I can submit Inquiries without privacy concerns.

#### Acceptance Criteria

1. THE Portfolio_Site SHALL display a link to the privacy policy page in the site footer on every page, and the linked page SHALL describe at minimum the categories of personal data collected, the purposes of collection, the retention period, and the contact method for data-related requests.
2. THE Portfolio_Site SHALL serve all pages, static assets, and form submissions exclusively over HTTPS, and IF a request is received over HTTP, THEN THE Portfolio_Site SHALL redirect the request to the equivalent HTTPS URL.
3. THE Portfolio_Site SHALL store all Inquiry records and any attached files in an encrypted form at rest, such that the stored data is not readable without the decryption key.
4. WHERE analytics or tracking cookies are used, WHEN a Visitor loads any page of the Portfolio_Site for the first time within the current browser session and no prior consent record exists, THE Portfolio_Site SHALL display a cookie consent notice offering at minimum an explicit "Accept" and "Reject" choice, and SHALL NOT set or read any non-essential cookies until the Visitor selects "Accept".
5. IF a Visitor selects "Reject" on the cookie consent notice, THEN THE Portfolio_Site SHALL not set any non-essential cookies, SHALL persist the rejection decision for at least 180 days, and SHALL not redisplay the consent notice during that period unless the Visitor clears site data.
6. WHEN an Admin confirms deletion of an Inquiry through the CMS, THE CMS SHALL permanently remove the Inquiry record and all attached files from primary storage and any backup or replica storage within 24 hours of the confirmation, and SHALL display a confirmation message indicating that the deletion has been scheduled or completed.
7. IF permanent deletion of an Inquiry or its attached files fails or cannot be completed within 24 hours, THEN THE CMS SHALL retain the Inquiry in a "pending deletion" state, SHALL display an error message to the Admin indicating the deletion failure, and SHALL retry the deletion automatically up to 3 times before requiring Admin intervention.
